using System;
using System.Collections.Generic;
using System.IO;

namespace VoxelValley.Core
{
    /// <summary>Block counts a player carries. Owned by the server.</summary>
    public sealed class Inventory
    {
        public const int MaxStack = 999;

        readonly Dictionary<BlockId, int> _counts = new Dictionary<BlockId, int>();

        /// <summary>What a brand-new player starts with.</summary>
        public static Inventory Starter()
        {
            var inv = new Inventory();
            inv.Add(BlockId.Planks, 16);
            inv.Add(BlockId.Glass, 4);
            return inv;
        }

        public int Count(BlockId id) => _counts.TryGetValue(id, out var n) ? n : 0;

        public IEnumerable<KeyValuePair<BlockId, int>> Entries => _counts;

        public void Add(BlockId id, int amount = 1)
        {
            if (id == BlockId.Air || amount <= 0) return;
            _counts[id] = Math.Min(MaxStack, Count(id) + amount);
        }

        public bool TryTake(BlockId id, int amount = 1)
        {
            int n = Count(id);
            if (amount <= 0 || n < amount) return false;
            if (n == amount) _counts.Remove(id);
            else _counts[id] = n - amount;
            return true;
        }

        /// <summary>id,count pairs for network transfer.</summary>
        public int[] Pack()
        {
            var data = new int[_counts.Count * 2];
            int i = 0;
            foreach (var kv in _counts) { data[i++] = (int)kv.Key; data[i++] = kv.Value; }
            return data;
        }

        public static Inventory Unpack(int[] data)
        {
            var inv = new Inventory();
            for (int i = 0; i + 1 < data.Length; i += 2)
                if (data[i] >= 0 && data[i] <= 255 && Blocks.IsKnown((byte)data[i]))
                    inv.Add((BlockId)data[i], data[i + 1]);
            return inv;
        }

        public void Write(BinaryWriter w)
        {
            w.Write(_counts.Count);
            foreach (var kv in _counts) { w.Write((byte)kv.Key); w.Write(kv.Value); }
        }

        public static Inventory Read(BinaryReader r)
        {
            var inv = new Inventory();
            int n = r.ReadInt32();
            for (int i = 0; i < n; i++)
            {
                var id = (BlockId)r.ReadByte();
                inv.Add(id, r.ReadInt32());
            }
            return inv;
        }
    }

    /// <summary>Day/night timing shared by server and clients.</summary>
    public static class DayCycle
    {
        /// <summary>Real seconds for one full day.</summary>
        public const float LengthSeconds = 600f;

        /// <summary>
        /// Brightness for a time of day in [0,1): 0 = sunrise, 0.25 = noon,
        /// 0.5 = sunset, 0.75 = midnight. Never fully dark.
        /// </summary>
        public static float Daylight(float t)
        {
            t -= (float)Math.Floor(t);
            float sun = (float)Math.Sin(t * 2 * Math.PI); // >0 during the day
            float k = Clamp01(sun * 3f + 0.35f);           // quick dawn/dusk
            return 0.22f + 0.78f * k;
        }

        public static bool IsNight(float t) => Daylight(t) < 0.5f;

        static float Clamp01(float v) => v < 0 ? 0 : v > 1 ? 1 : v;
    }
}
