using UnityEngine;

namespace VoxelValley
{
    /// <summary>First-person walking, jumping and looking for the local player.</summary>
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerController : MonoBehaviour
    {
        public float WalkSpeed = 4.6f;
        public float JumpHeight = 1.3f;
        public float Gravity = -24f;
        public Transform Head;

        CharacterController _cc;
        float _pitch;
        float _vy;
        bool _spawned;

        public bool Spawned => _spawned;

        void Awake() => _cc = GetComponent<CharacterController>();

        void Update()
        {
            var world = GameBootstrap.Instance.World;
            if (!_spawned)
            {
                TrySpawn(world);
                return;
            }
            // Don't fall through chunks that haven't been built yet.
            if (!world.IsReadyAt(transform.position)) return;

            var look = GameInput.ConsumeLook();
            transform.Rotate(0, look.x, 0, Space.Self);
            _pitch = Mathf.Clamp(_pitch - look.y, -89f, 89f);
            if (Head != null) Head.localRotation = Quaternion.Euler(_pitch, 0, 0);

            var input = GameInput.Move;
            var move = (transform.right * input.x + transform.forward * input.y) * WalkSpeed;

            if (_cc.isGrounded && _vy < 0) _vy = -2f;
            bool jump = GameInput.ConsumeJumpTap() | GameInput.Jump;
            if (_cc.isGrounded && jump) _vy = Mathf.Sqrt(JumpHeight * -2f * Gravity);
            _vy += Gravity * Time.deltaTime;
            _cc.Move((move + Vector3.up * _vy) * Time.deltaTime);

            if (transform.position.y < -20) _spawned = false; // fell out: respawn
        }

        void TrySpawn(WorldView world)
        {
            if (!world.HasWorld) return;
            var (x, y, z) = world.World.FindSpawn(Random.Range(-4, 5), Random.Range(-4, 5));
            _cc.enabled = false;
            transform.position = new Vector3(x + 0.5f, y + 0.05f, z + 0.5f);
            _cc.enabled = true;
            _vy = 0;
            _spawned = true;
        }
    }
}
