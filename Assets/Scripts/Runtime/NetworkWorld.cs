using System.Collections.Generic;
using System.Linq;
using Unity.Netcode;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Server-authoritative world sync. The server owns the edits; joining
    /// clients get the seed plus every edit, then all later edits are
    /// validated by the server and broadcast.
    /// </summary>
    public sealed class NetworkWorld : NetworkBehaviour
    {
        const int EditsPerMessage = 200;

        public static NetworkWorld Instance { get; private set; }
        public bool Ready { get; private set; }

        WorldView View => GameBootstrap.Instance.World;

        // Client-side download state.
        int _seed, _expected, _received;
        WorldEdits _incoming;
        readonly List<BlockEdit> _early = new List<BlockEdit>();

        public override void OnNetworkSpawn()
        {
            Instance = this;
            if (IsServer)
            {
                var world = SaveSystem.LoadOrCreate();
                View.Initialize(world);
                Ready = true;
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
        }

        // --------------------------------------------------------------- edits

        /// <summary>Asks the server to set a block (Air = break).</summary>
        public void RequestEdit(Vector3Int b, BlockId id)
        {
            if (Ready) RequestEditRpc(b.x, b.y, b.z, (byte)id);
        }

        [Rpc(SendTo.Server)]
        void RequestEditRpc(int x, int y, int z, byte id, RpcParams rpcParams = default)
        {
            if (!Blocks.IsKnown(id)) return;
            var sender = NetworkManager.ConnectedClients.TryGetValue(rpcParams.Receive.SenderClientId, out var c)
                ? c.PlayerObject : null;
            if (sender == null) return;

            var p = sender.transform.position;
            var eye = new Vec3(p.x, p.y + NetworkPlayer.EyeHeight, p.z);
            var current = View.World.GetBlock(x, y, z);
            var placing = (BlockId)id;
            var result = placing == BlockId.Air
                ? EditRules.CanBreak(eye, x, y, z, current)
                : EditRules.CanPlace(eye, x, y, z, current, placing, NetworkPlayer.AllFeet());
            if (result != EditResult.Ok) return;

            ApplyEditRpc(x, y, z, id);
        }

        [Rpc(SendTo.ClientsAndHost)]
        void ApplyEditRpc(int x, int y, int z, byte id)
        {
            if (Ready) View.SetBlock(x, y, z, (BlockId)id);
            else _early.Add(new BlockEdit(x, y, z, (BlockId)id)); // arrived mid-download
        }
    }
}
