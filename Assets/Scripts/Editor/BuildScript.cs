using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace VoxelValley.EditorTools
{
    /// <summary>Command-line builds: -executeMethod VoxelValley.EditorTools.BuildScript.Android</summary>
    public static class BuildScript
    {
        [MenuItem("Tools/Voxel Valley/Build Android APK")]
        public static void Android() => Build(BuildTarget.Android, "Build/Android/VoxelValley.apk");

        [MenuItem("Tools/Voxel Valley/Build macOS")]
        public static void MacOS() => Build(BuildTarget.StandaloneOSX, "Build/macOS/VoxelValley.app");

        [MenuItem("Tools/Voxel Valley/Build iOS (Xcode project)")]
        public static void IOS()
        {
            PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
            PlayerSettings.iOS.appleEnableAutomaticSigning = true;
            var team = Environment.GetEnvironmentVariable("IOS_TEAM_ID");
            if (!string.IsNullOrEmpty(team)) PlayerSettings.iOS.appleDeveloperTeamID = team;
            Build(BuildTarget.iOS, "Build/iOS");
        }

        /// <summary>
        /// Browser build for GitHub Pages: Brotli with JS decompression fallback
        /// (Pages can't send Content-Encoding headers) and our own template:
        /// full-screen page, iOS home-screen install guide, offline cache.
        /// </summary>
        [MenuItem("Tools/Voxel Valley/Build WebGL")]
        public static void WebGL()
        {
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            PlayerSettings.WebGL.decompressionFallback = true;
            PlayerSettings.WebGL.template = "PROJECT:VoxelValley";
            // New id per build so the service worker refreshes cached files.
            PlayerSettings.SetTemplateCustomValue("BUILD_ID", DateTime.UtcNow.ToString("yyyyMMddHHmmss"));
            PlayerSettings.WebGL.dataCaching = true;
            Build(BuildTarget.WebGL, "Build/WebGL");
        }

        [MenuItem("Tools/Voxel Valley/Build iOS Simulator (Xcode project)")]
        public static void IOSSimulator()
        {
            PlayerSettings.iOS.sdkVersion = iOSSdkVersion.SimulatorSDK;
            PlayerSettings.iOS.simulatorSdkArchitecture = AppleMobileArchitectureSimulator.ARM64; // Apple Silicon Macs
            try { Build(BuildTarget.iOS, "Build/iOSSimulator"); }
            finally { PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK; }
        }

        static void Build(BuildTarget target, string output)
        {
            ProjectSetup.Run();
            Directory.CreateDirectory(Path.GetDirectoryName(output) ?? "Build");
            var options = new BuildPlayerOptions
            {
                scenes = new[] { ProjectSetup.ScenePath },
                locationPathName = output,
                target = target,
                options = BuildOptions.None,
            };
            var report = BuildPipeline.BuildPlayer(options);
            var s = report.summary;
            Debug.Log($"[VoxelValley] Build {s.result}: {output} ({s.totalSize / (1024 * 1024)} MB, {s.totalErrors} errors)");
            if (Application.isBatchMode) EditorApplication.Exit(s.result == BuildResult.Succeeded ? 0 : 1);
        }
    }
}
