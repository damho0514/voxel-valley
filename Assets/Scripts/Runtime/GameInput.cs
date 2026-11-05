using UnityEngine;
using UnityEngine.InputSystem;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// One place to read player intent from keyboard/mouse (desktop) and the
    /// on-screen controls (touch). Touch widgets write into the Touch* fields.
    /// </summary>
    public static class GameInput
    {
        public static float MouseSensitivity = 0.12f;
        public static float TouchSensitivity = 0.18f;

        // Written by on-screen controls.
        public static Vector2 TouchMove;
        public static Vector2 TouchLook;
        public static bool TouchJump, TouchBreak, TouchPlace;

        // Latched presses: a tap shorter than one frame still counts once.
        static bool _jumpTapped, _breakTapped, _placeTapped;

        public static void SetTouchJump(bool held) { TouchJump = held; _jumpTapped |= held; }
        public static void SetTouchBreak(bool held) { TouchBreak = held; _breakTapped |= held; }
        public static void SetTouchPlace(bool held) { TouchPlace = held; _placeTapped |= held; }

        public static bool ConsumeJumpTap() => Consume(ref _jumpTapped);
        public static bool ConsumeBreakTap() => Consume(ref _breakTapped);
        public static bool ConsumePlaceTap() => Consume(ref _placeTapped);

        static bool Consume(ref bool flag)
        {
            bool v = flag;
            flag = false;
            return v;
        }

        /// <summary>Whether gameplay should react to mouse/keyboard (not typing in UI).</summary>
        public static bool GameplayFocused = true;

        public static int SelectedSlot;
        public static BlockId SelectedBlock => Blocks.Placeable[SelectedSlot];

        public static bool CursorLocked => Cursor.lockState == CursorLockMode.Locked;

        public static Vector2 Move
        {
            get
            {
                var v = TouchMove;
                var k = Keyboard.current;
                if (k != null && GameplayFocused)
                {
                    if (k.wKey.isPressed || k.upArrowKey.isPressed) v.y += 1;
                    if (k.sKey.isPressed || k.downArrowKey.isPressed) v.y -= 1;
                    if (k.dKey.isPressed || k.rightArrowKey.isPressed) v.x += 1;
                    if (k.aKey.isPressed || k.leftArrowKey.isPressed) v.x -= 1;
                }
                return Vector2.ClampMagnitude(v, 1f);
            }
        }

        /// <summary>Look delta in degrees since last call.</summary>
        public static Vector2 ConsumeLook()
        {
            var look = TouchLook * TouchSensitivity;
            TouchLook = Vector2.zero;
            var m = Mouse.current;
            if (m != null && CursorLocked) look += m.delta.ReadValue() * MouseSensitivity;
            return look;
        }

        public static bool Jump =>
            TouchJump || (GameplayFocused && Keyboard.current != null && Keyboard.current.spaceKey.isPressed);

        public static bool BreakHeld =>
            TouchBreak || (CursorLocked && Mouse.current != null && Mouse.current.leftButton.isPressed);

        public static bool PlaceHeld =>
            TouchPlace || (CursorLocked && Mouse.current != null && Mouse.current.rightButton.isPressed);

        /// <summary>Number keys and the scroll wheel pick hotbar slots.</summary>
        public static void UpdateHotbar()
        {
            int count = Blocks.Placeable.Length;
            var k = Keyboard.current;
            if (k != null && GameplayFocused)
            {
                for (int i = 0; i < count && i < 9; i++)
                    if (k[Key.Digit1 + i].wasPressedThisFrame) SelectedSlot = i;
            }
            var m = Mouse.current;
            if (m != null && CursorLocked)
            {
                float scroll = m.scroll.ReadValue().y;
                if (scroll > 0.1f) SelectedSlot = (SelectedSlot + count - 1) % count;
                else if (scroll < -0.1f) SelectedSlot = (SelectedSlot + 1) % count;
            }
        }

        public static void ResetTouch()
        {
            TouchMove = TouchLook = Vector2.zero;
            TouchJump = TouchBreak = TouchPlace = false;
            _jumpTapped = _breakTapped = _placeTapped = false;
        }
    }
}
