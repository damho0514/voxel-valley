using System.Collections.Generic;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.UI;

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

        public static GameBootstrap Instance { get; private set; }

        [Header("Assigned by Tools/Voxel Valley/Setup Project")]
        public GameObject PlayerPrefab;
        public GameObject WorldPrefab;
        public Material VoxelMaterial;
        public Material ColorMaterial;
        public Material HighlightMaterial;

        public WorldView World { get; private set; }
        public Camera MainCamera { get; private set; }
        public Transform Highlight { get; private set; }
        public string LocalName { get; private set; } = "탐험가";
        public int LocalColor { get; private set; }

        NetworkManager _net;
        UnityTransport _transport;
        GameUi _ui;
        bool _inGame;
        float _joinTimeout, _saveTimer;
        List<string> _hostAddresses = new List<string>();

        void Awake()
        {
            Instance = this;
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            bool touch = Application.isMobilePlatform || System.Environment.CommandLine.Contains("-touch");

            VoxelMaterial.mainTexture = TextureAtlas.Texture;

            var cam = new GameObject("Main Camera") { tag = "MainCamera" };
            MainCamera = cam.AddComponent<Camera>();
            MainCamera.clearFlags = CameraClearFlags.SolidColor;
            MainCamera.backgroundColor = Sky;
            MainCamera.nearClipPlane = 0.05f;
            MainCamera.farClipPlane = 220f;
            cam.AddComponent<AudioListener>();

            World = new GameObject("World").AddComponent<WorldView>();
            World.Material = VoxelMaterial;
            World.ViewRadius = touch ? 4 : 6;
            World.MeshesPerFrame = touch ? 2 : 4;

            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Sky;
            RenderSettings.fogStartDistance = World.ViewRadius * 16 * 0.55f;
            RenderSettings.fogEndDistance = World.ViewRadius * 16 * 0.95f;

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
            _ui.JoinRequested += Join;
            _ui.LeaveRequested += () => Leave(null);

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
            if (System.Array.IndexOf(args, "-host") >= 0) Host(name ?? "방장");
            else if (Arg("-join") is { } address) Join(name ?? "탐험가", address);
        }

        // ------------------------------------------------------------- session

        void Host(string name)
        {
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

        void Join(string name, string address)
        {
            if (string.IsNullOrWhiteSpace(address))
            {
                _ui.SetStatus("방 주소를 입력해 주세요.");
                return;
            }
            Remember(name, address);
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
            if (_net.IsServer && World.HasWorld) SaveSystem.Save(World.World);
            _inGame = false;
            _joinTimeout = 0;
            _net.Shutdown();
            World.Clear();
            DetachCamera();
            Highlight.gameObject.SetActive(false);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
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

            string info = $"{NetworkPlayer.All.Count}명 접속 중";
            if (_net.IsServer)
                info = (_hostAddresses.Count > 0 ? $"방 주소: {_hostAddresses[0]}" : "방 주소를 찾을 수 없어요") + "   ·   " + info;
            _ui.SetInfo(info);

            if (!_ui.TouchUi) UpdateCursor();

            if (_net.IsServer)
            {
                _saveTimer += Time.unscaledDeltaTime;
                if (_saveTimer > 30f)
                {
                    _saveTimer = 0;
                    SaveSystem.Save(World.World);
                }
            }
        }

        void UpdateCursor()
        {
            var k = Keyboard.current;
            var m = Mouse.current;
            if (k != null && k.escapeKey.wasPressedThisFrame)
            {
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }
            else if (m != null && m.leftButton.wasPressedThisFrame && !GameInput.CursorLocked &&
                     (EventSystem.current == null || !EventSystem.current.IsPointerOverGameObject()))
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }
        }

        void OnApplicationPause(bool paused)
        {
            if (paused && _net != null && _net.IsServer && World.HasWorld) SaveSystem.Save(World.World);
        }

        void OnApplicationQuit()
        {
            if (_net != null && _net.IsServer && World.HasWorld) SaveSystem.Save(World.World);
        }
    }
}
