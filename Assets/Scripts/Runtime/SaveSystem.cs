using System;
using System.IO;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>Stores the host's world (seed + edits) on the device.</summary>
    public static class SaveSystem
    {
        static string PathName => System.IO.Path.Combine(Application.persistentDataPath, "world.dat");

        public static VoxelWorld LoadOrCreate()
        {
            try
            {
                if (File.Exists(PathName))
                {
                    using var file = File.OpenRead(PathName);
                    var edits = new WorldEdits();
                    int seed = WorldEdits.Read(file, edits);
                    Debug.Log($"[VoxelValley] Loaded world {seed} with {edits.Count} edits");
                    return new VoxelWorld(seed, edits);
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[VoxelValley] Could not load save, starting fresh: {e.Message}");
            }
            return new VoxelWorld(UnityEngine.Random.Range(1, int.MaxValue));
        }

        public static void Save(VoxelWorld world)
        {
            if (world == null) return;
            try
            {
                var tmp = PathName + ".tmp";
                using (var file = File.Create(tmp)) world.Edits.Write(file, world.Seed);
                if (File.Exists(PathName)) File.Delete(PathName);
                File.Move(tmp, PathName);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[VoxelValley] Save failed: {e.Message}");
            }
        }

        public static void Delete()
        {
            try { if (File.Exists(PathName)) File.Delete(PathName); } catch (Exception) { }
        }
    }
}
