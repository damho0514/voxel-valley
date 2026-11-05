using System.IO;
using Unity.Netcode;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;

namespace VoxelValley.EditorTools
{
    /// <summary>
    /// Creates everything that would otherwise be hand-edited YAML: player
    /// settings, materials, network prefabs and the game scene.
    /// Run from the menu or with -executeMethod VoxelValley.EditorTools.ProjectSetup.Run
    /// </summary>
    public static class ProjectSetup
    {
        const string Generated = "Assets/Generated";
        public const string ScenePath = "Assets/Scenes/Game.unity";

        [MenuItem("Tools/Voxel Valley/Setup Project")]
        public static void Run()
        {
            ConfigurePlayer();
            Directory.CreateDirectory(Generated);
            Directory.CreateDirectory("Assets/Scenes");

            var voxel = MaterialAsset("Voxel", "VoxelValley/Voxel", m => { });
            var color = MaterialAsset("Color", "VoxelValley/Color", m => m.SetColor("_Color", Color.white));
            var highlight = MaterialAsset("Highlight", "VoxelValley/Color", m =>
            {
                m.SetColor("_Color", new Color(0, 0, 0, 0.22f));
                m.SetFloat("_Lit", 0);
                m.SetFloat("_ZWrite", 0);
                m.renderQueue = (int)RenderQueue.Transparent;
            });

            var water = MaterialAsset("Water", "VoxelValley/Water", m => m.renderQueue = (int)RenderQueue.Transparent);
            var player = PlayerPrefab();
            var world = WorldPrefab();
            CreateScene(player, world, voxel, color, highlight, water);
            AssetDatabase.SaveAssets();
            Debug.Log("[VoxelValley] Project setup complete");
        }

        static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "damho0514";
            PlayerSettings.productName = "Voxel Valley";
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.damho0514.voxelvalley");
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.iOS, "com.damho0514.voxelvalley");
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Standalone, "com.damho0514.voxelvalley");
            PlayerSettings.bundleVersion = "0.1.0";
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
            PlayerSettings.allowedAutorotateToLandscapeLeft = true;
            PlayerSettings.allowedAutorotateToLandscapeRight = true;
            PlayerSettings.allowedAutorotateToPortrait = false;
            PlayerSettings.allowedAutorotateToPortraitUpsideDown = false;
            PlayerSettings.colorSpace = ColorSpace.Gamma;
            PlayerSettings.defaultScreenWidth = 1280;
            PlayerSettings.defaultScreenHeight = 720;
            PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
            PlayerSettings.resizableWindow = true;
            PlayerSettings.runInBackground = true;

            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel25;
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.iOS.targetOSVersionString = "15.0";

            // Input System only.
            var settings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset");
            if (settings.Length > 0)
            {
                var so = new SerializedObject(settings[0]);
                var handler = so.FindProperty("activeInputHandler");
                if (handler != null)
                {
                    handler.intValue = 1;
                    so.ApplyModifiedProperties();
                }
            }

            // Keep the custom shaders in every build.
            var graphics = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (graphics.Length > 0)
            {
                var so = new SerializedObject(graphics[0]);
                var list = so.FindProperty("m_AlwaysIncludedShaders");
                foreach (var name in new[] { "VoxelValley/Voxel", "VoxelValley/Color", "VoxelValley/Water" })
                {
                    var shader = Shader.Find(name);
                    if (shader == null) continue;
                    bool present = false;
                    for (int i = 0; i < list.arraySize; i++)
                        if (list.GetArrayElementAtIndex(i).objectReferenceValue == shader) present = true;
                    if (present) continue;
                    list.InsertArrayElementAtIndex(list.arraySize);
                    list.GetArrayElementAtIndex(list.arraySize - 1).objectReferenceValue = shader;
                }
                so.ApplyModifiedProperties();
            }
        }

        static Material MaterialAsset(string name, string shader, System.Action<Material> configure)
        {
            var path = $"{Generated}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(Shader.Find(shader));
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = Shader.Find(shader);
            configure(mat);
            EditorUtility.SetDirty(mat);
            return mat;
        }

        static GameObject PlayerPrefab()
        {
            var path = $"{Generated}/Player.prefab";
            var go = new GameObject("Player");
            go.AddComponent<NetworkObject>();
            var nt = go.AddComponent<OwnerNetworkTransform>();
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            nt.SyncRotAngleX = nt.SyncRotAngleZ = false;
            var cc = go.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.radius = 0.3f;
            cc.center = new Vector3(0, 0.9f, 0);
            cc.stepOffset = 0.45f;
            cc.skinWidth = 0.04f;
            cc.minMoveDistance = 0;
            go.AddComponent<NetworkPlayer>();
            go.AddComponent<PlayerController>().enabled = false;
            go.AddComponent<BlockInteractor>().enabled = false;
            var head = new GameObject("Head");
            head.transform.SetParent(go.transform, false);
            head.transform.localPosition = new Vector3(0, NetworkPlayer.EyeHeight, 0);
            go.layer = 2;
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            return prefab;
        }

        static GameObject WorldPrefab()
        {
            var path = $"{Generated}/NetworkWorld.prefab";
            var go = new GameObject("NetworkWorld");
            go.AddComponent<NetworkObject>();
            go.AddComponent<NetworkWorld>();
            var prefab = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            return prefab;
        }

        static void CreateScene(GameObject player, GameObject world, Material voxel, Material color, Material highlight, Material water)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            // Fog is set at runtime; enabling it here keeps its shader variants in builds.
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.ambientMode = AmbientMode.Flat;

            var boot = new GameObject("Bootstrap").AddComponent<GameBootstrap>();
            boot.PlayerPrefab = player;
            boot.WorldPrefab = world;
            boot.VoxelMaterial = voxel;
            boot.ColorMaterial = color;
            boot.HighlightMaterial = highlight;
            boot.WaterMaterial = water;

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }
    }
}
