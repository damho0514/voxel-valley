using System.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace VoxelValley
{
    /// <summary>Builds uGUI widgets from code (no prefabs) with a Korean-capable font.</summary>
    public static class UiFactory
    {
        static Font _font;

        /// <summary>
        /// The bundled NanumGothic (SIL OFL, has Hangul) so every platform looks
        /// the same and the web build — which can't use OS fonts — shows Korean.
        /// Falls back to an OS font, then Unity's built-in one.
        /// </summary>
        public static Font Font
        {
            get
            {
                if (_font != null) return _font;
                _font = Resources.Load<Font>("Fonts/NanumGothic-Regular");
                if (_font != null) return _font;
                string[] preferred =
                {
                    "Apple SD Gothic Neo", "AppleSDGothicNeo", "Noto Sans CJK KR", "NotoSansCJK",
                    "Noto Sans KR", "Malgun Gothic", "Droid Sans Fallback", "Roboto",
                };
                string[] installed = { };
                try { installed = Font.GetOSInstalledFontNames(); } catch { }
                var pick = preferred
                    .Select(p => installed.FirstOrDefault(n => n.Replace(" ", "").ToLowerInvariant()
                        .Contains(p.Replace(" ", "").ToLowerInvariant())))
                    .FirstOrDefault(n => n != null);
                var builtin = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                _font = pick != null ? Font.CreateDynamicFontFromOSFont(new[] { pick, "sans-serif" }, 32) : builtin;
                return _font;
            }
        }

        static Sprite _circle;

        /// <summary>A soft-edged white circle, drawn once in code.</summary>
        public static Sprite Circle
        {
            get
            {
                if (_circle != null) return _circle;
                const int n = 128;
                var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
                var px = new Color32[n * n];
                for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(n / 2f, n / 2f));
                    byte a = (byte)(Mathf.Clamp01(n / 2f - d) * 255);
                    px[y * n + x] = new Color32(255, 255, 255, a);
                }
                tex.SetPixels32(px);
                tex.Apply();
                _circle = Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f));
                return _circle;
            }
        }

        public static RectTransform Round(RectTransform r)
        {
            r.GetComponent<Image>().sprite = Circle;
            return r;
        }

        public static RectTransform Panel(Transform parent, string name, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            go.GetComponent<Image>().color = color;
            return (RectTransform)go.transform;
        }

        public static RectTransform Empty(Transform parent, string name)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        public static Text Label(Transform parent, string text, int size, TextAnchor align = TextAnchor.MiddleCenter,
            Color? color = null)
        {
            var go = new GameObject("Label", typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            var t = go.GetComponent<Text>();
            t.font = Font;
            t.text = text;
            t.fontSize = size;
            t.alignment = align;
            t.color = color ?? Color.white;
            t.raycastTarget = false;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        public static Button Button(Transform parent, string text, Color color, System.Action onClick, int fontSize = 30)
        {
            var rect = Panel(parent, text, color);
            var b = rect.gameObject.AddComponent<Button>();
            b.onClick.AddListener(() => onClick());
            var label = Label(rect, text, fontSize);
            label.supportRichText = true;
            Stretch(label.rectTransform);
            return b;
        }

        public static InputField Input(Transform parent, string placeholder, string value, int fontSize = 30)
        {
            var rect = Panel(parent, "Input", new Color(1, 1, 1, 0.95f));
            var field = rect.gameObject.AddComponent<InputField>();
            var text = Label(rect, "", fontSize, TextAnchor.MiddleLeft, new Color(0.1f, 0.1f, 0.12f));
            text.supportRichText = false;
            Stretch(text.rectTransform, 16);
            var ph = Label(rect, placeholder, fontSize, TextAnchor.MiddleLeft, new Color(0.45f, 0.45f, 0.5f));
            ph.fontStyle = FontStyle.Italic;
            Stretch(ph.rectTransform, 16);
            field.textComponent = text;
            field.placeholder = ph;
            field.text = value;
            return field;
        }

        public static void Stretch(RectTransform r, float inset = 0)
        {
            r.anchorMin = Vector2.zero;
            r.anchorMax = Vector2.one;
            r.offsetMin = new Vector2(inset, 0);
            r.offsetMax = new Vector2(-inset, 0);
        }

        /// <summary>Anchors at a normalised point with a fixed size.</summary>
        public static RectTransform Place(RectTransform r, Vector2 anchor, Vector2 pos, Vector2 size)
        {
            r.anchorMin = r.anchorMax = anchor;
            r.pivot = anchor;
            r.anchoredPosition = pos;
            r.sizeDelta = size;
            return r;
        }
    }
}
