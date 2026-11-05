using System;
using System.Collections.Generic;
using System.IO;

namespace VoxelValley.Core
{
    /// <summary>
    /// Everything the host persists: seed, time of day, block edits and each
    /// player's inventory (by nickname). Reads the older v1 format too.
    /// </summary>
    public sealed class WorldSave
    {
        const int Magic = 0x56565632; // "VVV2"

        public int Seed;
        public float TimeOfDay = 0.05f; // early morning
        public WorldEdits Edits = new WorldEdits();
        public Dictionary<string, Inventory> Inventories = new Dictionary<string, Inventory>();

        public void Write(Stream stream)
        {
            using (var w = new BinaryWriter(stream, System.Text.Encoding.UTF8, leaveOpen: true))
            {
                w.Write(Magic);
                w.Write(Seed);
                w.Write(TimeOfDay);
                w.Flush();
                Edits.Write(stream, Seed);
                w.Write(Inventories.Count);
                foreach (var kv in Inventories)
                {
                    w.Write(kv.Key);
                    kv.Value.Write(w);
                }
            }
        }

        public static WorldSave Read(Stream stream)
        {
            var save = new WorldSave();
            using (var r = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true))
            {
                int head = r.ReadInt32();
                if (head != Magic)
                {
                    // v1: the file is just the edits block.
                    stream.Position -= 4;
                    save.Seed = WorldEdits.Read(stream, save.Edits);
                    return save;
                }
                save.Seed = r.ReadInt32();
                save.TimeOfDay = r.ReadSingle();
                WorldEdits.Read(stream, save.Edits);
                int n = r.ReadInt32();
                for (int i = 0; i < n; i++)
                {
                    var name = r.ReadString();
                    save.Inventories[name] = Inventory.Read(r);
                }
            }
            return save;
        }
    }

    /// <summary>Chat text clean-up shared by client and server.</summary>
    public static class ChatRules
    {
        public const int MaxLength = 80;
        public const int Burst = 5;
        public static readonly TimeSpan Window = TimeSpan.FromSeconds(5);

        /// <summary>Trims, collapses whitespace, strips control characters and caps length.</summary>
        public static string Clean(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            var sb = new System.Text.StringBuilder(text.Length);
            bool space = false;
            foreach (char ch in text)
            {
                if (char.IsWhiteSpace(ch)) { space = sb.Length > 0; continue; }
                if (char.IsControl(ch) || ch == '<' || ch == '>') continue;
                if (space) { sb.Append(' '); space = false; }
                sb.Append(ch);
                if (sb.Length >= MaxLength) break;
            }
            return sb.ToString();
        }
    }
}
