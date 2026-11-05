using System;
using System.Collections.Generic;
using System.Linq;
using Unity.Netcode;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Server-authoritative world state: blocks, inventories, time of day and
    /// chat. Joining clients get the seed plus every edit; later edits are
    /// validated by the server and broadcast.
    /// </summary>
    public sealed class NetworkWorld : NetworkBehaviour
    {
        const int EditsPerMessage = 200;
        const int EditsPerSecond = 12;

        public static NetworkWorld Instance { get; private set; }
        public bool Ready { get; private set; }

        /// <summary>Time of day at server time zero; see <see cref="TimeOfDay"/>.</summary>
        readonly NetworkVariable<float> _timeOffset = new NetworkVariable<float>();

        /// <summary>This client's inventory as last reported by the server.</summary>
        public Inventory LocalInventory { get; private set; } = new Inventory();

        public event Action<string, string> ChatReceived;

        WorldView View => GameBootstrap.Instance.World;

        // Server state.
        WorldSave _save;
        readonly Dictionary<ulong, Queue<float>> _editTimes = new Dictionary<ulong, Queue<float>>();
        readonly Dictionary<ulong, Queue<float>> _chatTimes = new Dictionary<ulong, Queue<float>>();

        // Client-side download state.
        int _seed, _expected, _received;
        WorldEdits _incoming;
        readonly List<BlockEdit> _early = new List<BlockEdit>();

        /// <summary>0..1 through the day, identical on every peer.</summary>
        public float TimeOfDay
        {
            get
            {
                double t = _timeOffset.Value + NetworkManager.ServerTime.Time / DayCycle.LengthSeconds;
                return (float)(t - Math.Floor(t));
            }
        }

        public override void OnNetworkSpawn()
        {
            Instance = this;
            if (IsServer)
            {
                _save = SaveSystem.Load();
                _timeOffset.Value = GameBootstrap.Instance.StartTime ?? _save.TimeOfDay;
                View.Initialize(new VoxelWorld(_save.Seed, _save.Edits));
                Ready = true;
                // The host's own player may have spawned before this object did.
                if (NetworkPlayer.Local != null) RequestInventory();
            }
            else
            {
                RequestWorldRpc();
            }
        }

        public override void OnNetworkDespawn()
        {
            if (Instance == this) Instance = null;
            Ready = false;
        }

        /// <summary>Snapshot for saving (server only).</summary>
        public WorldSave CaptureSave()
        {
            if (!IsServer || _save == null) return null;
            _save.TimeOfDay = TimeOfDay;
            return _save;
        }

        // ---------------------------------------------------------------- join

        [Rpc(SendTo.Server)]
        void RequestWorldRpc(RpcParams rpcParams = default)
        {
            ulong sender = rpcParams.Receive.SenderClientId;
            var edits = View.World.Edits.All().ToList();
            BeginWorldRpc(View.World.Seed, edits.Count, RpcTarget.Single(sender, RpcTargetUse.Temp));
            for (int i = 0; i < edits.Count; i += EditsPerMessage)
            {
                var batch = edits.GetRange(i, Mathf.Min(EditsPerMessage, edits.Count - i));
                WorldEditsRpc(WorldEdits.Pack(batch), RpcTarget.Single(sender, RpcTargetUse.Temp));
            }
        }

        [Rpc(SendTo.SpecifiedInParams)]
        void BeginWorldRpc(int seed, int editCount, RpcParams rpcParams)
        {
            _seed = seed;
            _expected = editCount;
            _received = 0;
            _incoming = new WorldEdits();
            if (_expected == 0) FinishDownload();
        }

        [Rpc(SendTo.SpecifiedInParams)]
        void WorldEditsRpc(int[] packed, RpcParams rpcParams)
        {
            if (_incoming == null) return;
            foreach (var e in WorldEdits.Unpack(packed))
            {
                _incoming.Set(e.X, e.Y, e.Z, e.Id);
                _received++;
            }
            if (_received >= _expected) FinishDownload();
        }

        void FinishDownload()
        {
            View.Initialize(new VoxelWorld(_seed, _incoming));
            _incoming = null;
            Ready = true;
            foreach (var e in _early) View.SetBlock(e.X, e.Y, e.Z, e.Id);
            _early.Clear();
            RequestInventory();
        }

        // ----------------------------------------------------------- inventory

        public void RequestInventory() => RequestInventoryRpc();

        [Rpc(SendTo.Server)]
        void RequestInventoryRpc(RpcParams rpcParams = default) => SendInventory(rpcParams.Receive.SenderClientId);

        Inventory InventoryOf(ulong clientId)
        {
            var name = PlayerName(clientId);
            if (!_save.Inventories.TryGetValue(name, out var inv))
                _save.Inventories[name] = inv = Inventory.Starter();
            return inv;
        }

        string PlayerName(ulong clientId)
        {
            var obj = NetworkManager.ConnectedClients.TryGetValue(clientId, out var c) ? c.PlayerObject : null;
            var name = obj != null ? obj.GetComponent<NetworkPlayer>().Nickname.Value.ToString() : "";
            return string.IsNullOrWhiteSpace(name) ? $"player{clientId}" : name;
        }

        void SendInventory(ulong clientId) =>
            InventoryRpc(InventoryOf(clientId).Pack(), RpcTarget.Single(clientId, RpcTargetUse.Temp));

        [Rpc(SendTo.SpecifiedInParams)]
        void InventoryRpc(int[] packed, RpcParams rpcParams) => LocalInventory = Inventory.Unpack(packed);

        // --------------------------------------------------------------- edits

        /// <summary>Asks the server to set a block (Air = break).</summary>
        public void RequestEdit(Vector3Int b, BlockId id)
        {
            if (Ready) RequestEditRpc(b.x, b.y, b.z, (byte)id);
        }

        [Rpc(SendTo.Server)]
        void RequestEditRpc(int x, int y, int z, byte id, RpcParams rpcParams = default)
        {
            ulong senderId = rpcParams.Receive.SenderClientId;
            if (!Blocks.IsKnown(id) || !Allow(_editTimes, senderId, EditsPerSecond, 1f)) return;
            var sender = NetworkManager.ConnectedClients.TryGetValue(senderId, out var c) ? c.PlayerObject : null;
            if (sender == null) return;

            var p = sender.transform.position;
            var eye = new Vec3(p.x, p.y + NetworkPlayer.EyeHeight, p.z);
            var current = View.World.GetBlock(x, y, z);
            var placing = (BlockId)id;
            var inventory = InventoryOf(senderId);

            if (placing == BlockId.Air)
            {
                if (EditRules.CanBreak(eye, x, y, z, current) != EditResult.Ok) return;
                inventory.Add(Blocks.DropOf(current));
            }
            else
            {
                if (EditRules.CanPlace(eye, x, y, z, current, placing, NetworkPlayer.AllFeet()) != EditResult.Ok) return;
                if (!inventory.TryTake(placing)) return;
            }
            ApplyEditRpc(x, y, z, id);
            SendInventory(senderId);
        }

        [Rpc(SendTo.ClientsAndHost)]
        void ApplyEditRpc(int x, int y, int z, byte id)
        {
            if (Ready) View.SetBlock(x, y, z, (BlockId)id);
            else _early.Add(new BlockEdit(x, y, z, (BlockId)id)); // arrived mid-download
        }

        // ---------------------------------------------------------------- chat

        public void SendChat(string text)
        {
            text = ChatRules.Clean(text);
            if (text.Length > 0) SendChatRpc(text);
        }

        [Rpc(SendTo.Server)]
        void SendChatRpc(string text, RpcParams rpcParams = default)
        {
            ulong sender = rpcParams.Receive.SenderClientId;
            text = ChatRules.Clean(text);
            if (text.Length == 0 || !Allow(_chatTimes, sender, ChatRules.Burst, (float)ChatRules.Window.TotalSeconds))
                return;
            ChatRpc(PlayerName(sender), text);
        }

        [Rpc(SendTo.ClientsAndHost)]
        void ChatRpc(string name, string text) => ChatReceived?.Invoke(name, text);

        // -------------------------------------------------------------- limits

        /// <summary>Sliding-window rate limit per client.</summary>
        static bool Allow(Dictionary<ulong, Queue<float>> log, ulong client, int max, float window)
        {
            float now = Time.unscaledTime;
            if (!log.TryGetValue(client, out var q)) log[client] = q = new Queue<float>();
            while (q.Count > 0 && now - q.Peek() >= window) q.Dequeue();
            if (q.Count >= max) return false;
            q.Enqueue(now);
            return true;
        }
    }
}
