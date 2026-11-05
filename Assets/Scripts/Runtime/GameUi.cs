using System;
using UnityEngine;
using UnityEngine.UI;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>Main menu, in-game HUD and touch controls, all built in code.</summary>
    public sealed class GameUi : MonoBehaviour
    {
        public event Action<string> HostRequested;
        public event Action<string, string> JoinRequested;
        public event Action LeaveRequested;
        public event Action<string> ChatSubmitted;
        public event Action ChatClosed;

        RectTransform _menu, _hud, _touch;
        InputField _name, _address;
        Text _status, _info, _blockName;
        Image[] _slots;
        Text[] _counts;
        RawImage[] _icons;
        Text _chatLog;
        RectTransform _chatBar;
        InputField _chatInput;
        readonly System.Collections.Generic.List<(string line, float time)> _chatLines =
            new System.Collections.Generic.List<(string, float)>();

        int _chatClosedFrame = -1;

        public bool ChatOpen => _chatBar != null && _chatBar.gameObject.activeSelf;
        Image _fade;

        public bool TouchUi { get; private set; }

        public void Build(bool touch, string savedName, string savedAddress)
        {
            TouchUi = touch;
            var canvasGo = new GameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvasGo.transform.SetParent(transform, false);
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1600, 900);
            scaler.matchWidthOrHeight = 0.5f;
            var root = canvasGo.transform;

            BuildHud(root);
            BuildMenu(root, savedName, savedAddress);
            ShowMenu(null);
        }

        // ---------------------------------------------------------------- menu

        void BuildMenu(Transform root, string savedName, string savedAddress)
        {
            _menu = UiFactory.Panel(root, "Menu", new Color(0.08f, 0.16f, 0.2f, 0.82f));
            UiFactory.Stretch(_menu);

            var card = UiFactory.Place(UiFactory.Panel(_menu, "Card", new Color(1, 1, 1, 0.08f)),
                new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(760, 720));

            UiFactory.Place(UiFactory.Label(card, "Voxel Valley", 72).rectTransform,
                new Vector2(0.5f, 1), new Vector2(0, -40), new Vector2(700, 90));
            UiFactory.Place(UiFactory.Label(card, "블록으로 만드는 우리만의 계곡", 30, color: new Color(0.8f, 0.9f, 0.95f)).rectTransform,
                new Vector2(0.5f, 1), new Vector2(0, -130), new Vector2(700, 40));

            _name = UiFactory.Input(card, "닉네임", savedName);
            _name.characterLimit = 16;
            UiFactory.Place((RectTransform)_name.transform, new Vector2(0.5f, 1), new Vector2(0, -200), new Vector2(560, 76));

            UiFactory.Place((RectTransform)UiFactory.Button(card, "방 만들기 (혼자 · 같이)", new Color(0.27f, 0.62f, 0.33f),
                () => HostRequested?.Invoke(PlayerName())).transform, new Vector2(0.5f, 1), new Vector2(0, -300), new Vector2(560, 90));

            UiFactory.Place(UiFactory.Label(card, "친구 방에 참가하기", 26, color: new Color(0.8f, 0.9f, 0.95f)).rectTransform,
                new Vector2(0.5f, 1), new Vector2(0, -420), new Vector2(560, 36));
            _address = UiFactory.Input(card, "방 주소 (예: 192.168.0.12)", savedAddress);
            _address.contentType = InputField.ContentType.Standard;
            UiFactory.Place((RectTransform)_address.transform, new Vector2(0.5f, 1), new Vector2(-95, -465), new Vector2(370, 76));
            UiFactory.Place((RectTransform)UiFactory.Button(card, "참가", new Color(0.24f, 0.47f, 0.75f),
                () => JoinRequested?.Invoke(PlayerName(), _address.text.Trim())).transform,
                new Vector2(0.5f, 1), new Vector2(190, -465), new Vector2(180, 76));

            _status = UiFactory.Label(card, "", 26, color: new Color(1f, 0.85f, 0.6f));
            UiFactory.Place(_status.rectTransform, new Vector2(0.5f, 0), new Vector2(0, 40), new Vector2(700, 110));
        }

        string PlayerName()
        {
            var n = _name.text.Trim();
            return string.IsNullOrEmpty(n) ? "탐험가" : n;
        }

        public void ShowMenu(string message)
        {
            if (_chatBar != null) _chatBar.gameObject.SetActive(false);
            _chatLines.Clear();
            _menu.gameObject.SetActive(true);
            _hud.gameObject.SetActive(false);
            SetStatus(message);
            GameInput.ResetTouch();
        }

        public void SetStatus(string message) => _status.text = message ?? "";

        public void ShowHud()
        {
            _menu.gameObject.SetActive(false);
            _hud.gameObject.SetActive(true);
        }

        // ----------------------------------------------------------------- hud

        void BuildHud(Transform root)
        {
            _hud = UiFactory.Empty(root, "Hud");
            UiFactory.Stretch(_hud);

            if (TouchUi) BuildTouch(_hud); // first, so it sits behind the other HUD widgets

            // Crosshair
            var ch = UiFactory.Empty(_hud, "Crosshair");
            UiFactory.Place(ch, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(40, 40));
            UiFactory.Place(UiFactory.Panel(ch, "H", new Color(1, 1, 1, 0.85f)), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(28, 4));
            UiFactory.Place(UiFactory.Panel(ch, "V", new Color(1, 1, 1, 0.85f)), new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(4, 28));
            foreach (var g in ch.GetComponentsInChildren<Image>()) g.raycastTarget = false;

            // Info (room address, players)
            _info = UiFactory.Label(_hud, "", 26, TextAnchor.UpperLeft);
            _info.gameObject.AddComponent<Shadow>();
            UiFactory.Place(_info.rectTransform, new Vector2(0, 1), new Vector2(24, -20), new Vector2(900, 120));

            UiFactory.Place((RectTransform)UiFactory.Button(_hud, "나가기", new Color(0, 0, 0, 0.45f),
                () => LeaveRequested?.Invoke(), 26).transform, new Vector2(1, 1), new Vector2(-24, -20), new Vector2(150, 64));
            if (TouchUi)
                UiFactory.Place((RectTransform)UiFactory.Button(_hud, "채팅", new Color(0, 0, 0, 0.45f),
                    () => { if (ChatOpen) CloseChat(); else OpenChat(); }, 26).transform,
                    new Vector2(1, 1), new Vector2(-190, -20), new Vector2(130, 64));

            // Chat: recent lines under the info text, input bar near the top.
            _chatLog = UiFactory.Label(_hud, "", 24, TextAnchor.UpperLeft);
            _chatLog.gameObject.AddComponent<Shadow>();
            _chatLog.supportRichText = true;
            UiFactory.Place(_chatLog.rectTransform, new Vector2(0, 1), new Vector2(24, -90), new Vector2(760, 260));
            _chatBar = UiFactory.Place(UiFactory.Empty(_hud, "ChatBar"), new Vector2(0.5f, 1), new Vector2(0, -96), new Vector2(820, 72));
            _chatInput = UiFactory.Input(_chatBar, "메시지 입력 (Enter 보내기 · Esc 닫기)", "", 26);
            _chatInput.characterLimit = ChatRules.MaxLength;
            UiFactory.Place((RectTransform)_chatInput.transform, new Vector2(0, 0.5f), Vector2.zero, new Vector2(670, 68));
            UiFactory.Place((RectTransform)UiFactory.Button(_chatBar, "보내기", new Color(0.24f, 0.47f, 0.75f),
                SubmitChat, 26).transform, new Vector2(1, 0.5f), Vector2.zero, new Vector2(140, 68));
            _chatInput.onSubmit.AddListener(_ => SubmitChat());
            _chatBar.gameObject.SetActive(false);

            // Hotbar
            int n = Blocks.Placeable.Length;
            const float slot = 84, gap = 8;
            var bar = UiFactory.Place(UiFactory.Panel(_hud, "Hotbar", new Color(0, 0, 0, 0.35f)),
                new Vector2(0.5f, 0), new Vector2(0, 16), new Vector2(n * (slot + gap) + gap, slot + 2 * gap));
            _slots = new Image[n];
            _counts = new Text[n];
            _icons = new RawImage[n];
            for (int i = 0; i < n; i++)
            {
                int index = i;
                var frame = UiFactory.Place(UiFactory.Panel(bar, $"Slot{i}", new Color(1, 1, 1, 0.15f)),
                    new Vector2(0, 0.5f), new Vector2(gap + i * (slot + gap), 0), new Vector2(slot, slot));
                frame.gameObject.AddComponent<Button>().onClick.AddListener(() => GameInput.SelectedSlot = index);
                var icon = new GameObject("Icon", typeof(RectTransform), typeof(RawImage));
                icon.transform.SetParent(frame, false);
                var raw = icon.GetComponent<RawImage>();
                raw.texture = TextureAtlas.Texture;
                var info = Blocks.Get(Blocks.Placeable[i]);
                raw.uvRect = TextureAtlas.TileRect(info.Side);
                raw.raycastTarget = false;
                UiFactory.Place((RectTransform)icon.transform, new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(slot - 20, slot - 20));
                _slots[i] = frame.GetComponent<Image>();
                _icons[i] = raw;
                _counts[i] = UiFactory.Label(frame, "", 24, TextAnchor.LowerRight);
                _counts[i].gameObject.AddComponent<Outline>();
                UiFactory.Place(_counts[i].rectTransform, new Vector2(1, 0), new Vector2(-6, 2), new Vector2(70, 30));
            }
            _blockName = UiFactory.Label(_hud, "", 26);
            _blockName.gameObject.AddComponent<Shadow>();
            UiFactory.Place(_blockName.rectTransform, new Vector2(0.5f, 0), new Vector2(0, slot + 2 * gap + 24), new Vector2(400, 36));

            if (!TouchUi)
            {
                var help = UiFactory.Label(_hud, "WASD 이동 · Space 점프/수영 · 좌클릭 꾹 캐기 · 우클릭 놓기 · 1~9/휠 블록 · Enter 채팅 · Esc 마우스 해제", 22,
                    TextAnchor.LowerRight, new Color(1, 1, 1, 0.8f));
                help.gameObject.AddComponent<Shadow>();
                UiFactory.Place(help.rectTransform, new Vector2(1, 0), new Vector2(-20, 12), new Vector2(1100, 30));
            }

            _fade = UiFactory.Panel(_hud, "Loading", new Color(0.55f, 0.75f, 0.95f, 1f)).GetComponent<Image>();
            UiFactory.Stretch((RectTransform)_fade.transform);
            var loading = UiFactory.Label(_fade.transform, "월드를 불러오는 중...", 40, color: new Color(0.1f, 0.2f, 0.3f));
            UiFactory.Stretch(loading.rectTransform);
        }

        void BuildTouch(Transform hud)
        {
            _touch = UiFactory.Empty(hud, "Touch");
            UiFactory.Stretch(_touch);

            // Look: right 60% of the screen.
            var look = UiFactory.Panel(_touch, "LookPad", new Color(0, 0, 0, 0));
            look.anchorMin = new Vector2(0.4f, 0);
            look.anchorMax = Vector2.one;
            look.offsetMin = look.offsetMax = Vector2.zero;
            look.gameObject.AddComponent<LookPad>();

            // Joystick: bottom-left.
            var stick = UiFactory.Place(UiFactory.Round(UiFactory.Panel(_touch, "Joystick", new Color(0, 0, 0, 0.25f))),
                new Vector2(0, 0), new Vector2(70, 60), new Vector2(240, 240));
            var knob = UiFactory.Place(UiFactory.Round(UiFactory.Panel(stick, "Knob", new Color(1, 1, 1, 0.6f))),
                new Vector2(0.5f, 0.5f), Vector2.zero, new Vector2(110, 110));
            knob.pivot = new Vector2(0.5f, 0.5f);
            knob.GetComponent<Image>().raycastTarget = false;
            var js = stick.gameObject.AddComponent<VirtualJoystick>();
            js.Knob = knob;

            HoldButtonAt("점프", new Vector2(-60, 70), new Color(0.2f, 0.2f, 0.25f, 0.55f), GameInput.SetTouchJump);
            HoldButtonAt("캐기", new Vector2(-230, 200), new Color(0.75f, 0.3f, 0.25f, 0.6f), GameInput.SetTouchBreak);
            HoldButtonAt("놓기", new Vector2(-60, 240), new Color(0.25f, 0.55f, 0.3f, 0.6f), GameInput.SetTouchPlace);
        }

        void HoldButtonAt(string label, Vector2 pos, Color color, Action<bool> onChanged)
        {
            var b = UiFactory.Place(UiFactory.Round(UiFactory.Panel(_touch, label, color)), new Vector2(1, 0), pos, new Vector2(150, 150));
            var t = UiFactory.Label(b, label, 32);
            UiFactory.Stretch(t.rectTransform);
            b.gameObject.AddComponent<HoldButton>().OnChanged = onChanged;
        }

        public void SetLoading(bool loading) => _fade.gameObject.SetActive(loading);

        // ---------------------------------------------------------------- chat

        public void OpenChat()
        {
            _chatBar.gameObject.SetActive(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
            _chatInput.text = "";
            _chatInput.Select();
            _chatInput.ActivateInputField();
        }

        public void CloseChat()
        {
            if (!ChatOpen) return;
            _chatInput.DeactivateInputField();
            _chatBar.gameObject.SetActive(false);
            _chatClosedFrame = Time.frameCount;
            ChatClosed?.Invoke();
        }

        void SubmitChat()
        {
            var text = ChatRules.Clean(_chatInput.text);
            if (text.Length > 0) ChatSubmitted?.Invoke(text);
            CloseChat();
        }

        public void AddChat(string name, string text)
        {
            _chatLines.Add(($"<b>{Escape(name)}</b>: {Escape(text)}", Time.unscaledTime));
            if (_chatLines.Count > 6) _chatLines.RemoveAt(0);
            RefreshChat();
        }

        static string Escape(string s) => s.Replace("<", "‹").Replace(">", "›");

        void RefreshChat()
        {
            float now = Time.unscaledTime;
            var sb = new System.Text.StringBuilder();
            foreach (var (line, time) in _chatLines)
                if (ChatOpen || now - time < 12f) sb.AppendLine(line);
            _chatLog.text = sb.ToString();
        }

        public void SetInfo(string text) => _info.text = text;

        void Update()
        {
            if (_hud == null || !_hud.gameObject.activeSelf) return;
            for (int i = 0; i < _slots.Length; i++)
                _slots[i].color = i == GameInput.SelectedSlot ? new Color(1, 1, 1, 0.75f) : new Color(1, 1, 1, 0.15f);
            var inv = NetworkWorld.Instance != null ? NetworkWorld.Instance.LocalInventory : null;
            for (int i = 0; i < _slots.Length; i++)
            {
                int count = inv?.Count(Blocks.Placeable[i]) ?? 0;
                _counts[i].text = count > 0 ? count.ToString() : "";
                _icons[i].color = count > 0 ? Color.white : new Color(1, 1, 1, 0.3f);
            }
            int selected = inv?.Count(GameInput.SelectedBlock) ?? 0;
            _blockName.text = $"{Blocks.Get(GameInput.SelectedBlock).Name} ({selected})";
            GameInput.GameplayFocused = !(_name.isFocused || _address.isFocused || ChatOpen);
            RefreshChat();

            var k = UnityEngine.InputSystem.Keyboard.current;
            if (k != null && !TouchUi)
            {
                // The Enter that sent a message must not reopen the box in the same frame.
                if (!ChatOpen && Time.frameCount != _chatClosedFrame &&
                    (k.enterKey.wasPressedThisFrame || k.tKey.wasPressedThisFrame)) OpenChat();
                else if (ChatOpen && k.escapeKey.wasPressedThisFrame) CloseChat();
            }
        }
    }
}
