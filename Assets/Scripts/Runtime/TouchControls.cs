using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace VoxelValley
{
    /// <summary>Left-thumb stick that writes <see cref="GameInput.TouchMove"/>.</summary>
    public sealed class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        public RectTransform Knob;
        public float Radius = 90;
        RectTransform _rect;

        void Awake() => _rect = (RectTransform)transform;

        public void OnPointerDown(PointerEventData e) => OnDrag(e);

        public void OnDrag(PointerEventData e)
        {
            RectTransformUtility.ScreenPointToLocalPointInRectangle(_rect, e.position, e.pressEventCamera, out var local);
            var v = Vector2.ClampMagnitude(local, Radius);
            Knob.anchoredPosition = v;
            GameInput.TouchMove = v / Radius;
        }

        public void OnPointerUp(PointerEventData e)
        {
            Knob.anchoredPosition = Vector2.zero;
            GameInput.TouchMove = Vector2.zero;
        }

        void OnDisable() => GameInput.TouchMove = Vector2.zero;
    }

    /// <summary>Drag anywhere on this area to look around.</summary>
    public sealed class LookPad : MonoBehaviour, IDragHandler
    {
        public void OnDrag(PointerEventData e) => GameInput.TouchLook += e.delta;
    }

    /// <summary>A button that reports "held" while pressed.</summary>
    public sealed class HoldButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler, IPointerExitHandler
    {
        public System.Action<bool> OnChanged;
        Image _image;
        Color _normal;

        void Awake()
        {
            _image = GetComponent<Image>();
            if (_image != null) _normal = _image.color;
        }

        public void OnPointerDown(PointerEventData e) => Set(true);
        public void OnPointerUp(PointerEventData e) => Set(false);
        public void OnPointerExit(PointerEventData e) => Set(false);
        void OnDisable() => Set(false);

        void Set(bool held)
        {
            OnChanged?.Invoke(held);
            if (_image != null) _image.color = held ? _normal * 1.4f : _normal;
        }
    }
}
