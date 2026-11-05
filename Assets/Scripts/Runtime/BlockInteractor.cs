using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>Aims at blocks from the screen centre and requests break/place edits.</summary>
    public sealed class BlockInteractor : MonoBehaviour
    {
        const float RepeatDelay = 0.25f;

        public Camera Camera;
        public Transform Highlight;

        float _breakCooldown, _placeCooldown;
        bool _breakWasHeld, _placeWasHeld;

        public bool HasTarget { get; private set; }
        public Vector3Int Target { get; private set; }
        public Vector3Int PlaceAt { get; private set; }

        void Update()
        {
            GameInput.UpdateHotbar();
            Aim();
            if (Highlight != null)
            {
                Highlight.gameObject.SetActive(HasTarget);
                if (HasTarget) Highlight.position = Target + new Vector3(0.5f, 0.5f, 0.5f);
            }
            bool breakTap = GameInput.ConsumeBreakTap();
            bool placeTap = GameInput.ConsumePlaceTap();
            if (!HasTarget || NetworkWorld.Instance == null) return;

            if (Repeat(GameInput.BreakHeld, ref _breakWasHeld, ref _breakCooldown) || (breakTap && !_breakWasHeld))
                NetworkWorld.Instance.RequestEdit(Target, BlockId.Air);

            if (Repeat(GameInput.PlaceHeld, ref _placeWasHeld, ref _placeCooldown) || (placeTap && !_placeWasHeld))
            {
                var feet = transform.position;
                var self = new[] { new Vec3(feet.x, feet.y, feet.z) };
                var eye = Camera.transform.position;
                var world = GameBootstrap.Instance.World;
                var result = EditRules.CanPlace(new Vec3(eye.x, eye.y, eye.z), PlaceAt.x, PlaceAt.y, PlaceAt.z,
                    world.GetBlock(PlaceAt), GameInput.SelectedBlock, self);
                if (result == EditResult.Ok)
                    NetworkWorld.Instance.RequestEdit(PlaceAt, GameInput.SelectedBlock);
            }
        }

        /// <summary>Fires on press, then every <see cref="RepeatDelay"/> while held.</summary>
        static bool Repeat(bool held, ref bool wasHeld, ref float cooldown)
        {
            cooldown -= Time.deltaTime;
            bool fire = held && (!wasHeld || cooldown <= 0);
            wasHeld = held;
            if (fire) cooldown = RepeatDelay;
            return fire;
        }

        void Aim()
        {
            HasTarget = false;
            if (Camera == null) return;
            var ray = Camera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0));
            // Chunks live on the Default layer; players are on Ignore Raycast.
            if (!Physics.Raycast(ray, out var hit, EditRules.Reach, 1 << 0, QueryTriggerInteraction.Ignore)) return;
            Target = WorldView.ToBlock(hit.point - hit.normal * 0.5f);
            PlaceAt = WorldView.ToBlock(hit.point + hit.normal * 0.5f);
            HasTarget = true;
        }
    }
}
