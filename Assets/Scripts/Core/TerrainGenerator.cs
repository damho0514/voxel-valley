namespace VoxelValley.Core
{
    /// <summary>Fills chunks with hills, beaches, lakes, rock and trees from a seed.</summary>
    public sealed class TerrainGenerator
    {
        public const int SeaLevel = 20;
        readonly Noise _noise;
        public readonly int Seed;

        public TerrainGenerator(int seed)
        {
            Seed = seed;
            _noise = new Noise(seed);
        }

        /// <summary>Y of the highest solid terrain block (before trees).</summary>
        public int SurfaceHeight(int x, int z)
        {
            float hills = _noise.Fractal(x / 48f, z / 48f, 4);
            float mountains = _noise.Fractal(x / 160f, z / 160f, 2, 7);
            float m = mountains * mountains;
            int h = (int)(hills * 30 + m * 26);
            return h < 1 ? 1 : (h > Chunk.Height - 10 ? Chunk.Height - 10 : h);
        }

        public Chunk Generate(ChunkCoord coord)
        {
            var chunk = new Chunk(coord);
            for (int lx = 0; lx < Chunk.Size; lx++)
            for (int lz = 0; lz < Chunk.Size; lz++)
            {
                int wx = chunk.WorldX(lx), wz = chunk.WorldZ(lz);
                int top = SurfaceHeight(wx, wz);
                bool beach = top <= SeaLevel;
                // Low ground floods up to sea level.
                for (int y = top + 1; y <= SeaLevel; y++) chunk.Set(lx, y, lz, BlockId.Water);
                for (int y = 0; y <= top; y++)
                {
                    BlockId id;
                    if (y == 0) id = BlockId.Bedrock;
                    else if (y < top - 3) id = BlockId.Stone;
                    else if (beach) id = BlockId.Sand;
                    else id = y == top ? BlockId.Grass : BlockId.Dirt;
                    chunk.Set(lx, y, lz, id);
                }
            }
            PlantTrees(chunk);
            return chunk;
        }

        /// <summary>
        /// Trees only grow where the whole tree fits inside this chunk, so a
        /// chunk never depends on its neighbours' generation.
        /// </summary>
        void PlantTrees(Chunk chunk)
        {
            for (int lx = 2; lx <= Chunk.Size - 3; lx++)
            for (int lz = 2; lz <= Chunk.Size - 3; lz++)
            {
                int wx = chunk.WorldX(lx), wz = chunk.WorldZ(lz);
                if (_noise.Hash01(wx, wz, 101) > 0.012f) continue;
                int ground = SurfaceHeight(wx, wz);
                if (chunk.Get(lx, ground, lz) != BlockId.Grass) continue;
                int trunk = 4 + (int)(_noise.Hash01(wx, wz, 202) * 2);
                if (ground + trunk + 2 >= Chunk.Height) continue;

                for (int y = 1; y <= trunk; y++) chunk.Set(lx, ground + y, lz, BlockId.Log);
                int crown = ground + trunk;
                for (int dy = -1; dy <= 2; dy++)
                {
                    int r = dy >= 1 ? 1 : 2;
                    for (int dx = -r; dx <= r; dx++)
                    for (int dz = -r; dz <= r; dz++)
                    {
                        if (r == 2 && (dx == -2 || dx == 2) && (dz == -2 || dz == 2)) continue;
                        int x = lx + dx, y = crown + dy, z = lz + dz;
                        if (chunk.Get(x, y, z) == BlockId.Air) chunk.Set(x, y, z, BlockId.Leaves);
                    }
                }
            }
        }
    }
}
