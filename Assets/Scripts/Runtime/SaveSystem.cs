using System;
using System.IO;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>Stores the host's world (seed, time, edits, inventories) on the device.</summary>
    public static class SaveSystem
    {
        static string PathName => Path.Combine(Application.persistentDataPath, "world.dat");

        public static WorldSave Load()
        {
            try
            {
                if (File.Exists(PathName))
                {
                    using var file = File.OpenRead(PathName);
                    var save = WorldSave.Read(file);
                    Debug.Log($"[VoxelValley] Loaded world {save.Seed}: {save.Edits.Count} edits, {save.Inventories.Count} players");
                    return save;
                }
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[VoxelValley] Could not load save, starting fresh: {e.Message}");
            }
            return new WorldSave { Seed = UnityEngine.Random.Range(1, int.MaxValue) };
        }

        public static void Save(WorldSave save)
        {
            if (save == null) return;
            try
            {
                var tmp = PathName + ".tmp";
                using (var file = File.Create(tmp)) save.Write(file);
                if (File.Exists(PathName)) File.Delete(PathName);
                File.Move(tmp, PathName);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[VoxelValley] Save failed: {e.Message}");
            }
        }
    }
}
