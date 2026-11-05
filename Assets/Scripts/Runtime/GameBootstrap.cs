using System.Collections.Generic;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Entry point: builds camera, world, UI and networking at runtime, and
    /// handles hosting, joining and leaving.
    /// </summary>
    public sealed class GameBootstrap : MonoBehaviour
    {
        public const ushort Port = 7777;
        static readonly Color Sky = new Color(0.55f, 0.76f, 0.95f);
        static readonly Color NightSky = new Color(0.04f, 0.06f, 0.14f);
        static readonly Color Underwater = new Color(0.12f, 0.3f, 0.55f);
        static readonly int DaylightId = Shader.PropertyToID("_Daylight");
        NetworkWorld _chatSource;
        float _fogStart, _fogEnd;

        public static GameBootstrap Instance { get; private set; }

        [Header("Assigned by Tools/Voxel Valley/Setup Project")]
        public GameObject PlayerPrefab;
        public GameObject WorldPrefab;
        public Material VoxelMaterial;
        public Material ColorMaterial;
        public Material HighlightMaterial;
        public Material WaterMaterial;

        public WorldView World { get; private set; }
        public Camera MainCamera { get; private set; }
        public Transform Highlight { get; private set; }
        public string LocalName { get; private set; } = "탐험가";
        public int LocalColor { get; private set; }

        /// <summary>Host-only <c>-time 0..1</c> override for the starting time of day.</summary>
        public float? StartTime { get; private set; }

        NetworkManager _net;
        UnityTransport _transport;
        GameUi _ui;
        bool _inGame;
        float _joinTimeout, _saveTimer;
        List<string> _hostAddresses = new List<string>();
        string _joinCode;
        bool _busy;

        void Awake()
        {
            Instance = this;
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            bool touch = Application.isMobilePlatform || System.Environment.CommandLine.Contains("-touch");

            VoxelMaterial.mainTexture = TextureAtlas.Texture;
            WaterMaterial.mainTexture = TextureAtlas.Texture;
            Shader.SetGlobalFloat(DaylightId, 1f);

            var cam = new GameObject("Main Camera") { tag = "MainCamera" };
            MainCamera = cam.AddComponent<Camera>();
            MainCamera.clearFlags = CameraClearFlags.SolidColor;
            MainCamera.backgroundColor = Sky;
            MainCamera.nearClipPlane = 0.05f;
            MainCamera.farClipPlane = 220f;
            cam.AddComponent<AudioListener>();

            World = new GameObject("World").AddComponent<WorldView>();
            World.Material = VoxelMaterial;
            World.WaterMaterial = WaterMaterial;
            World.ViewRadius = touch ? 4 : 6;
            World.MeshesPerFrame = touch ? 2 : 4;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Sky;
            RenderSettings.fogStartDistance = World.ViewRadius * 16 * 0.55f;
            RenderSettings.fogEndDistance = World.ViewRadius * 16 * 0.95f;
            _fogStart = RenderSettings.fogStartDistance;
            _fogEnd = RenderSettings.fogEndDistance;

            var hl = GameObject.CreatePrimitive(PrimitiveType.Cube);
            hl.name = "Highlight";
            Destroy(hl.GetComponent<Collider>());
            hl.layer = 2;
            hl.transform.localScale = Vector3.one * 1.02f;
            hl.GetComponent<Renderer>().sharedMaterial = HighlightMaterial;
            hl.SetActive(false);
            Highlight = hl.transform;

            new GameObject("EventSystem", typeof(EventSystem), typeof(InputSystemUIInputModule));

            var netGo = new GameObject("Network");
            _transport = netGo.AddComponent<UnityTransport>();
            _net = netGo.AddComponent<NetworkManager>();
            // Only filled in automatically when the component is added in the editor.
            _net.NetworkConfig ??= new NetworkConfig();
            _net.NetworkConfig.NetworkTransport = _transport;
            _net.NetworkConfig.PlayerPrefab = PlayerPrefab;
            _net.NetworkConfig.EnableSceneManagement = false;
            _net.NetworkConfig.ConnectionApproval = false;
            _net.AddNetworkPrefab(WorldPrefab);
            _net.OnServerStarted += OnServerStarted;
            _net.OnClientConnectedCallback += OnClientConnected;
            _net.OnClientDisconnectCallback += OnClientDisconnected;

            _ui = new GameObject("UI").AddComponent<GameUi>();
            _ui.Build(touch, PlayerPrefs.GetString("vv.name", ""), PlayerPrefs.GetString("vv.address", ""));
            _ui.HostRequested += Host;
            _ui.HostOnlineRequested += HostOnline;
            _ui.JoinRequested += Join;
            _ui.LeaveRequested += () => Leave(null);
            _ui.ChatSubmitted += text => NetworkWorld.Instance?.SendChat(text);
            _ui.ChatClosed += () => { if (!_ui.TouchUi && _inGame) LockCursor(true); };

            LocalColor = PlayerPrefs.GetInt("vv.color", Random.Range(0, PlayerAvatar.Palette.Length));
            PlayerPrefs.SetInt("vv.color", LocalColor);
            ParkCamera();
        }

        /// <summary>
        /// Command line: <c>-host</c> or <c>-join &lt;ip&gt;</c>, optional <c>-name &lt;nickname&gt;</c>.
        /// Lets a desktop build run as an unattended host (also with -batchmode -nographics).
        /// </summary>
        void Start()
        {
            var args = System.Environment.GetCommandLineArgs();
            string Arg(string key)
            {
                int i = System.Array.IndexOf(args, key);
                return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
            }
            var name = Arg("-name");
            if (float.TryParse(Arg("-time"), System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out var time)) StartTime = time;
            if (System.Array.IndexOf(args, "-host-online") >= 0) HostOnline(name ?? "방장");
            else if (System.Array.IndexOf(args, "-host") >= 0) Host(name ?? "방장");
            else if (Arg("-join") is { } address) Join(name ?? "탐험가", address);
        }

        // ------------------------------------------------------------- session

        void Host(string name)
        {
            _joinCode = null;
            Remember(name, null);
            _transport.SetConnectionData("127.0.0.1", Port, "0.0.0.0");
            if (!_net.StartHost())
            {
                _ui.SetStatus("방을 만들 수 없어요. 포트 7777이 사용 중인지 확인해 주세요.");
                return;
            }
            _hostAddresses = LocalAddress.IPv4();
            EnterGame();
        }

        async void HostOnline(string name)
        {
            if (_busy) return;
            _busy = true;
            Remember(name, null);
            _ui.SetStatus("온라인 방을 여는 중...");
            try
            {
                _joinCode = await RelayConnector.HostAsync(_transport);
            }
            catch (System.Exception e)
            {
                _ui.SetStatus(RelayConnector.Explain(e));
                _busy = false;
                return;
            }
            _busy = false;
            if (!_net.StartHost())
            {
                _ui.SetStatus("방을 만들 수 없어요.");
                return;
            }
            EnterGame();
        }

        async void JoinOnline(string code)
        {
            if (_busy) return;
            _busy = true;
            _ui.SetStatus($"참가 코드 {code.ToUpperInvariant()} 로 연결 중...");
            try
            {
                await RelayConnector.JoinAsync(_transport, code);
            }
            catch (System.Exception e)
            {
                _ui.SetStatus(RelayConnector.Explain(e));
                _busy = false;
                return;
            }
            _busy = false;
            if (!_net.StartClient())
            {
                _ui.SetStatus("접속을 시작할 수 없어요.");
                return;
            }
            _joinTimeout = 15f;
        }

        void Join(string name, string address)
        {
            if (string.IsNullOrWhiteSpace(address))
            {
                _ui.SetStatus("방 주소나 참가 코드를 입력해 주세요.");
                return;
            }
            Remember(name, address);
            if (RelayConnector.LooksLikeJoinCode(address))
            {
                JoinOnline(address.Trim());
                return;
            }
            _transport.SetConnectionData(address, Port);
            if (!_net.StartClient())
            {
                _ui.SetStatus("접속을 시작할 수 없어요.");
                return;
            }
            _ui.SetStatus($"{address} 에 연결 중...");
            _joinTimeout = 10f;
        }

        void Remember(string name, string address)
        {
            LocalName = name;
            PlayerPrefs.SetString("vv.name", name);
            if (address != null) PlayerPrefs.SetString("vv.address", address);
            PlayerPrefs.Save();
        }

        void OnServerStarted()
        {
            var world = Instantiate(WorldPrefab);
            world.GetComponent<NetworkObject>().Spawn();
        }

        void OnClientConnected(ulong clientId)
        {
            if (!_net.IsServer && clientId == _net.LocalClientId) EnterGame();
        }

        void OnClientDisconnected(ulong clientId)
        {
            if (_net.IsServer) return;
            if (clientId == _net.LocalClientId || clientId == NetworkManager.ServerClientId)
                Leave(_inGame ? "방과의 연결이 끊어졌어요." : "방에 접속할 수 없어요. 주소와 같은 와이파이인지 확인해 주세요.");
        }

        void EnterGame()
        {
            _inGame = true;
            _joinTimeout = 0;
            _saveTimer = 0;
            _ui.ShowHud();
            _ui.SetLoading(true);
        }

        void Leave(string message)
        {
            if (_net.IsServer) SaveSystem.Save(NetworkWorld.Instance?.CaptureSave());
            _inGame = false;
            _joinTimeout = 0;
            _joinCode = null;
            _net.Shutdown();
            World.Clear();
            DetachCamera();
            Highlight.gameObject.SetActive(false);
            LockCursor(false);
            Shader.SetGlobalFloat(DaylightId, 1f);
            MainCamera.backgroundColor = Sky;
            _ui.ShowMenu(message);
        }

        // -------------------------------------------------------------- camera

        public void AttachCamera(NetworkPlayer player)
        {
            MainCamera.transform.SetParent(player.Head, false);
            MainCamera.transform.localPosition = Vector3.zero;
            MainCamera.transform.localRotation = Quaternion.identity;
            World.Focus = player.transform;
        }

        public void DetachCamera()
        {
            if (MainCamera == null) return;
            MainCamera.transform.SetParent(null, true);
            World.Focus = null;
            ParkCamera();
        }

        void ParkCamera()
        {
            MainCamera.transform.SetPositionAndRotation(new Vector3(0, 60, -40), Quaternion.Euler(30, 0, 0));
        }

        // -------------------------------------------------------------- update

        void Update()
        {
            if (_joinTimeout > 0)
            {
                _joinTimeout -= Time.unscaledDeltaTime;
                if (_joinTimeout <= 0 && !_inGame)
                {
                    _net.Shutdown();
                    _ui.SetStatus("응답이 없어요. 주소와 같은 와이파이인지 확인해 주세요.");
                }
            }
            if (!_inGame) return;

            var local = NetworkPlayer.Local;
            bool ready = NetworkWorld.Instance != null && NetworkWorld.Instance.Ready && local != null &&
                         local.GetComponent<PlayerController>().Spawned && World.IsReadyAt(local.transform.position);
            _ui.SetLoading(!ready);

            UpdateSky(local);
            if (NetworkWorld.Instance != _chatSource)
            {
                _chatSource = NetworkWorld.Instance;
                if (_chatSource != null) _chatSource.ChatReceived += _ui.AddChat;
            }

            string info = $"{NetworkPlayer.All.Count}명 접속 중";
            if (NetworkWorld.Instance != null)
            {
                float t = NetworkWorld.Instance.TimeOfDay;
                float hours = (t * 24f + 6f) % 24f; // 0 = 6 AM sunrise
                info += $"   ·   {(DayCycle.IsNight(t) ? "밤" : "낮")} {(int)hours:00}:{(int)(hours % 1 * 60):00}";
            }
            if (_net.IsServer)
                info = (_joinCode != null ? $"참가 코드: {_joinCode}"
                    : _hostAddresses.Count > 0 ? $"방 주소: {_hostAddresses[0]}" : "방 주소를 찾을 수 없어요") + "   ·   " + info;
            _ui.SetInfo(info);

            if (!_ui.TouchUi) UpdateCursor();

            if (_net.IsServer)
            {
                _saveTimer += Time.unscaledDeltaTime;
                if (_saveTimer > 30f)
                {
                    _saveTimer = 0;
                    SaveSystem.Save(NetworkWorld.Instance?.CaptureSave());
                }
            }
        }

        void UpdateCursor()
        {
            if (_ui.ChatOpen) return;
            var k = Keyboard.current;
            var m = Mouse.current;
            if (k != null && k.escapeKey.wasPressedThisFrame) LockCursor(false);
            else if (m != null && m.leftButton.wasPressedThisFrame && !GameInput.CursorLocked &&
                     (EventSystem.current == null || !EventSystem.current.IsPointerOverGameObject()))
                LockCursor(true);
        }

        static void LockCursor(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        /// <summary>Day/night sky and light, and a murky blue fog under water.</summary>
        void UpdateSky(NetworkPlayer local)
        {
            float daylight = NetworkWorld.Instance != null ? DayCycle.Daylight(NetworkWorld.Instance.TimeOfDay) : 1f;
            Shader.SetGlobalFloat(DaylightId, daylight);
            var sky = Color.Lerp(NightSky, Sky, Mathf.InverseLerp(0.22f, 1f, daylight));
            bool underwater = local != null && World.IsWater(MainCamera.transform.position);
            RenderSettings.fogColor = underwater ? Underwater * Mathf.Max(daylight, 0.4f) : sky;
            RenderSettings.fogStartDistance = underwater ? 0f : _fogStart;
            RenderSettings.fogEndDistance = underwater ? 14f : _fogEnd;
            MainCamera.backgroundColor = RenderSettings.fogColor;
        }

        void OnApplicationPause(bool paused)
        {
            if (paused && _net != null && _net.IsServer) SaveSystem.Save(NetworkWorld.Instance?.CaptureSave());
        }

        void OnApplicationQuit()
        {
            if (_net != null && _net.IsServer) SaveSystem.Save(NetworkWorld.Instance?.CaptureSave());
        }
    }
}
