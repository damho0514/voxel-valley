using System;
using System.Collections.Generic;
using System.IO;

namespace VoxelValley.Core
{
    public readonly struct BlockEdit
    {
        public readonly int X, Y, Z;
        public readonly BlockId Id;
        public BlockEdit(int x, int y, int z, BlockId id) { X = x; Y = y; Z = z; Id = id; }
    }

    /// <summary>
    /// Every change players made on top of the generated terrain. The world is
    /// always "generator output + these edits", which keeps saves and network
    /// sync small.
    /// </summary>
    public sealed class WorldEdits
    {
        const int FileVersion = 1;
        readonly Dictionary<ChunkCoord, Dictionary<int, BlockId>> _byChunk =
            new Dictionary<ChunkCoord, Dictionary<int, BlockId>>();

        public int Count { get; private set; }

        public void Set(int x, int y, int z, BlockId id)
        {
            var coord = ChunkCoord.FromBlock(x, z);
            if (!_byChunk.TryGetValue(coord, out var edits))
                _byChunk[coord] = edits = new Dictionary<int, BlockId>();
            int index = Chunk.Index(ChunkCoord.Mod(x, Chunk.Size), y, ChunkCoord.Mod(z, Chunk.Size));
            if (!edits.ContainsKey(index)) Count++;
            edits[index] = id;
        }

        public void ApplyTo(Chunk chunk)
        {
            if (!_byChunk.TryGetValue(chunk.Coord, out var edits)) return;
            foreach (var kv in edits) chunk.SetIndex(kv.Key, kv.Value);
        }

        public IEnumerable<BlockEdit> All()
        {
            foreach (var chunk in _byChunk)
            foreach (var e in chunk.Value)
            {
                int i = e.Key;
                int lx = i % Chunk.Size, lz = i / Chunk.Size % Chunk.Size, y = i / (Chunk.Size * Chunk.Size);
                yield return new BlockEdit(chunk.Key.X * Chunk.Size + lx, y, chunk.Key.Z * Chunk.Size + lz, e.Value);
            }
        }

        /// <summary>Packs edits as x,y,z,id ints for network transfer.</summary>
        public static int[] Pack(IReadOnlyList<BlockEdit> edits)
        {
            var data = new int[edits.Count * 4];
            for (int i = 0; i < edits.Count; i++)
            {
                data[i * 4] = edits[i].X; data[i * 4 + 1] = edits[i].Y;
                data[i * 4 + 2] = edits[i].Z; data[i * 4 + 3] = (int)edits[i].Id;
            }
            return data;
        }

        public static IEnumerable<BlockEdit> Unpack(int[] data)
        {
            for (int i = 0; i + 3 < data.Length; i += 4)
            {
                if (!Blocks.IsKnown((byte)data[i + 3]) || data[i + 3] < 0 || data[i + 3] > 255) continue;
                yield return new BlockEdit(data[i], data[i + 1], data[i + 2], (BlockId)data[i + 3]);
            }
        }

        public void Write(Stream stream, int seed)
        {
            using (var w = new BinaryWriter(stream, System.Text.Encoding.UTF8, leaveOpen: true))
            {
                w.Write(FileVersion);
                w.Write(seed);
                w.Write(Count);
                foreach (var e in All())
                {
                    w.Write(e.X); w.Write((byte)e.Y); w.Write(e.Z); w.Write((byte)e.Id);
                }
            }
        }

        /// <summary>Reads a save; returns the seed.</summary>
        public static int Read(Stream stream, WorldEdits into)
        {
            using (var r = new BinaryReader(stream, System.Text.Encoding.UTF8, leaveOpen: true))
            {
                int version = r.ReadInt32();
                if (version != FileVersion) throw new InvalidDataException($"Unsupported save version {version}");
                int seed = r.ReadInt32();
                int count = r.ReadInt32();
                for (int i = 0; i < count; i++)
                {
                    int x = r.ReadInt32(); int y = r.ReadByte(); int z = r.ReadInt32(); var id = (BlockId)r.ReadByte();
                    into.Set(x, y, z, id);
                }
                return seed;
            }
        }
    }
}
