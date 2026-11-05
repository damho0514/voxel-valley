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
        public static void IOS() => Build(BuildTarget.iOS, "Build/iOS");

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
