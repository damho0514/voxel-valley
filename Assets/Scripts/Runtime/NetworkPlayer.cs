using System.Collections.Generic;
using System.Linq;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Per-player network state: nickname and colour. The owner gets the
    /// camera and controls; everyone else sees an avatar with a name tag.
    /// </summary>
    public sealed class NetworkPlayer : NetworkBehaviour
    {
        public const float EyeHeight = 1.6f;

        public static readonly List<NetworkPlayer> All = new List<NetworkPlayer>();
        public static NetworkPlayer Local { get; private set; }

        public readonly NetworkVariable<FixedString64Bytes> Nickname = new NetworkVariable<FixedString64Bytes>(
            default, NetworkVariableReadPermission.Everyone, NetworkVariableWritePermission.Owner);

        public readonly NetworkVariable<int> ColorIndex = new NetworkVariable<int>(
            0, NetworkVariableReadPermission.Everyone, NetworkVariableWritePermission.Owner);

        public Transform Head;
        PlayerAvatar _avatar;

        public static Vec3[] AllFeet() => All.Select(p =>
        {
            var t = p.transform.position;
            return new Vec3(t.x, t.y, t.z);
        }).ToArray();

        public override void OnNetworkSpawn()
        {
            All.Add(this);
            gameObject.layer = 2; // Ignore Raycast: block aiming passes through players
            Head = transform.Find("Head");

            var controller = GetComponent<PlayerController>();
            var interactor = GetComponent<BlockInteractor>();
            if (IsOwner)
            {
                Local = this;
                Nickname.Value = new FixedString64Bytes(GameBootstrap.Instance.LocalName);
                ColorIndex.Value = GameBootstrap.Instance.LocalColor;
                controller.Head = Head;
                controller.enabled = true;
                interactor.enabled = true;
                GameBootstrap.Instance.AttachCamera(this);
                interactor.Camera = GameBootstrap.Instance.MainCamera;
                interactor.Highlight = GameBootstrap.Instance.Highlight;
                // The host's world is ready immediately; clients ask after downloading it.
                if (NetworkWorld.Instance != null && NetworkWorld.Instance.Ready) NetworkWorld.Instance.RequestInventory();
            }
            else
            {
                controller.enabled = false;
                interactor.enabled = false;
                _avatar = PlayerAvatar.Build(transform, GameBootstrap.Instance.ColorMaterial);
                _avatar.SetLook(Nickname.Value.ToString(), ColorIndex.Value);
                Nickname.OnValueChanged += (_, v) => _avatar.SetLook(v.ToString(), ColorIndex.Value);
                ColorIndex.OnValueChanged += (_, v) => _avatar.SetLook(Nickname.Value.ToString(), v);
            }
        }

        public override void OnNetworkDespawn()
        {
            All.Remove(this);
            if (Local == this)
            {
                GameBootstrap.Instance.DetachCamera();
                Local = null;
            }
        }
    }
}
