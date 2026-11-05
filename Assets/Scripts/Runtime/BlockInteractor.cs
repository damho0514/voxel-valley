using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Aims at blocks from the screen centre. Breaking takes the block's
    /// hardness in seconds of holding; placing uses one item from the
    /// inventory. The server has the final say on both.
    /// </summary>
    public sealed class BlockInteractor : MonoBehaviour
    {
        const float PlaceRepeat = 0.25f;

        public Camera Camera;
        public Transform Highlight;

        float _placeCooldown;
        bool _placeWasHeld;
        float _dig;
        Vector3Int _digTarget;
        bool _waitingForServer;
        MaterialPropertyBlock _mpb;
        Renderer _highlightRenderer;

        public bool HasTarget { get; private set; }
        public Vector3Int Target { get; private set; }
        public Vector3Int PlaceAt { get; private set; }

        /// <summary>0..1 progress on the current block.</summary>
        public float DigProgress { get; private set; }

        void Update()
        {
            GameInput.UpdateHotbar();
            Aim();
            bool breakTap = GameInput.ConsumeBreakTap();
            bool placeTap = GameInput.ConsumePlaceTap();
            var net = NetworkWorld.Instance;
            UpdateDig(net, GameInput.BreakHeld || breakTap);
            UpdateHighlight();
            if (!HasTarget || net == null) return;

            if (Repeat(GameInput.PlaceHeld, ref _placeWasHeld, ref _placeCooldown) || (placeTap && !_placeWasHeld))
            {
                var block = GameInput.SelectedBlock;
                if (net.LocalInventory.Count(block) <= 0) return;
                var feet = transform.position;
                var eye = Camera.transform.position;
                var world = GameBootstrap.Instance.World;
                var result = EditRules.CanPlace(new Vec3(eye.x, eye.y, eye.z), PlaceAt.x, PlaceAt.y, PlaceAt.z,
                    world.GetBlock(PlaceAt), block, new[] { new Vec3(feet.x, feet.y, feet.z) });
                if (result == EditResult.Ok) net.RequestEdit(PlaceAt, block);
            }
        }

        void UpdateDig(NetworkWorld net, bool held)
        {
            var world = GameBootstrap.Instance.World;
            if (!held || !HasTarget || net == null || Target != _digTarget)
            {
                _dig = 0;
                _waitingForServer = false;
                _digTarget = Target;
                DigProgress = 0;
                return;
            }
            var info = Blocks.Get(world.GetBlock(Target));
            if (!info.Breakable || _waitingForServer) return;
            _dig += Time.deltaTime;
            DigProgress = Mathf.Clamp01(_dig / Mathf.Max(0.05f, info.Hardness));
            if (DigProgress >= 1f)
            {
                net.RequestEdit(Target, BlockId.Air);
                _waitingForServer = true; // the block changes when the server confirms
                _dig = 0;
                DigProgress = 0;
            }
        }

        void UpdateHighlight()
        {
            if (Highlight == null) return;
            Highlight.gameObject.SetActive(HasTarget);
            if (!HasTarget) return;
            Highlight.position = Target + new Vector3(0.5f, 0.5f, 0.5f);
            _highlightRenderer ??= Highlight.GetComponent<Renderer>();
            _mpb ??= new MaterialPropertyBlock();
            _mpb.SetColor("_Color", new Color(0, 0, 0, 0.18f + 0.5f * DigProgress));
            _highlightRenderer.SetPropertyBlock(_mpb);
        }

        /// <summary>Fires on press, then every <see cref="PlaceRepeat"/> while held.</summary>
        static bool Repeat(bool held, ref bool wasHeld, ref float cooldown)
        {
            cooldown -= Time.deltaTime;
            bool fire = held && (!wasHeld || cooldown <= 0);
            wasHeld = held;
            if (fire) cooldown = PlaceRepeat;
            return fire;
        }

        void Aim()
        {
            var had = HasTarget;
            var old = Target;
            HasTarget = false;
            if (Camera == null) return;
            var ray = Camera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0));
            // Chunk colliders (solid blocks only) live on the Default layer.
            if (!Physics.Raycast(ray, out var hit, EditRules.Reach, 1 << 0, QueryTriggerInteraction.Ignore)) return;
            Target = WorldView.ToBlock(hit.point - hit.normal * 0.5f);
            PlaceAt = WorldView.ToBlock(hit.point + hit.normal * 0.5f);
            HasTarget = true;
            if (!had || old != Target) _waitingForServer = false;
        }
    }
}
