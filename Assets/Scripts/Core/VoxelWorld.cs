using System;
using System.Collections.Generic;

namespace VoxelValley.Core
{
    /// <summary>
    /// The block data of the world: generated chunks plus player edits.
    /// Not thread-safe; owned by the main thread.
    /// </summary>
    public sealed class VoxelWorld
    {
        public readonly TerrainGenerator Generator;
        public readonly WorldEdits Edits;
        readonly Dictionary<ChunkCoord, Chunk> _chunks = new Dictionary<ChunkCoord, Chunk>();

        public VoxelWorld(int seed, WorldEdits edits = null)
        {
            Generator = new TerrainGenerator(seed);
            Edits = edits ?? new WorldEdits();
        }

        public int Seed => Generator.Seed;
        public IEnumerable<ChunkCoord> LoadedChunks => _chunks.Keys;

        public bool TryGetChunk(ChunkCoord c, out Chunk chunk) => _chunks.TryGetValue(c, out chunk);

        /// <summary>Returns the chunk, generating it (with edits) if needed.</summary>
        public Chunk GetOrCreateChunk(ChunkCoord c)
        {
            if (_chunks.TryGetValue(c, out var chunk)) return chunk;
            chunk = Generator.Generate(c);
            Edits.ApplyTo(chunk);
            _chunks[c] = chunk;
            return chunk;
        }

        public void Unload(ChunkCoord c) => _chunks.Remove(c);

        public BlockId GetBlock(int x, int y, int z)
        {
            if (y < 0 || y >= Chunk.Height) return BlockId.Air;
            var chunk = GetOrCreateChunk(ChunkCoord.FromBlock(x, z));
            return chunk.Get(ChunkCoord.Mod(x, Chunk.Size), y, ChunkCoord.Mod(z, Chunk.Size));
        }

        /// <summary>Looks up only already-loaded chunks; unknown space counts as air.</summary>
        public BlockId PeekBlock(int x, int y, int z)
        {
            if (y < 0 || y >= Chunk.Height) return BlockId.Air;
            return _chunks.TryGetValue(ChunkCoord.FromBlock(x, z), out var chunk)
                ? chunk.Get(ChunkCoord.Mod(x, Chunk.Size), y, ChunkCoord.Mod(z, Chunk.Size))
                : BlockId.Air;
        }

        /// <summary>Changes a block and records the edit. Returns the affected chunk.</summary>
        public ChunkCoord SetBlock(int x, int y, int z, BlockId id)
        {
            var coord = ChunkCoord.FromBlock(x, z);
            Edits.Set(x, y, z, id);
            if (_chunks.TryGetValue(coord, out var chunk))
                chunk.Set(ChunkCoord.Mod(x, Chunk.Size), y, ChunkCoord.Mod(z, Chunk.Size), id);
            return coord;
        }

        /// <summary>
        /// Nearest column to (x, z), searching outward in rings, whose top is
        /// open ground (grass or sand), so players never spawn on a tree or
        /// on something someone built.
        /// </summary>
        public (int x, int y, int z) FindSpawn(int x, int z, int maxRadius = 32)
        {
            for (int r = 0; r <= maxRadius; r++)
            for (int dx = -r; dx <= r; dx++)
            for (int dz = -r; dz <= r; dz++)
            {
                if (Math.Max(Math.Abs(dx), Math.Abs(dz)) != r) continue; // ring only
                int y = SpawnHeight(x + dx, z + dz);
                var ground = GetBlock(x + dx, y - 1, z + dz);
                bool headroom = GetBlock(x + dx, y, z + dz) == BlockId.Air && GetBlock(x + dx, y + 1, z + dz) == BlockId.Air;
                if ((ground == BlockId.Grass || ground == BlockId.Sand) && headroom) return (x + dx, y, z + dz);
            }
            return (x, SpawnHeight(x, z), z);
        }

        /// <summary>Highest y where a player can stand at (x, z).</summary>
        public int SpawnHeight(int x, int z)
        {
            for (int y = Chunk.Height - 2; y > 0; y--)
                if (Blocks.Get(GetBlock(x, y, z)).Solid) return y + 1;
            return Chunk.Height - 1;
        }
    }
}
