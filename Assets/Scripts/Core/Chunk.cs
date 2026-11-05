using System;

namespace VoxelValley.Core
{
    public readonly struct ChunkCoord : IEquatable<ChunkCoord>
    {
        public readonly int X, Z;
        public ChunkCoord(int x, int z) { X = x; Z = z; }

        public static ChunkCoord FromBlock(int bx, int bz) =>
            new ChunkCoord(FloorDiv(bx, Chunk.Size), FloorDiv(bz, Chunk.Size));

        public static int FloorDiv(int a, int b) => a >= 0 ? a / b : -((-a + b - 1) / b);
        public static int Mod(int a, int b) { int m = a % b; return m < 0 ? m + b : m; }

        public bool Equals(ChunkCoord o) => X == o.X && Z == o.Z;
        public override bool Equals(object obj) => obj is ChunkCoord o && Equals(o);
        public override int GetHashCode() => unchecked(X * 73856093 ^ Z * 19349663);
        public override string ToString() => $"({X},{Z})";
    }

    /// <summary>A 16 x 64 x 16 column of blocks.</summary>
    public sealed class Chunk
    {
        public const int Size = 16;
        public const int Height = 64;
        public const int Volume = Size * Size * Height;

        public readonly ChunkCoord Coord;
        readonly byte[] _blocks = new byte[Volume];

        public Chunk(ChunkCoord coord) { Coord = coord; }

        public static int Index(int x, int y, int z) => x + z * Size + y * Size * Size;

        public static bool InBounds(int x, int y, int z) =>
            x >= 0 && x < Size && z >= 0 && z < Size && y >= 0 && y < Height;

        public BlockId Get(int x, int y, int z) =>
            InBounds(x, y, z) ? (BlockId)_blocks[Index(x, y, z)] : BlockId.Air;

        public void Set(int x, int y, int z, BlockId id)
        {
            if (InBounds(x, y, z)) _blocks[Index(x, y, z)] = (byte)id;
        }

        public void SetIndex(int index, BlockId id) => _blocks[index] = (byte)id;
        public BlockId GetIndex(int index) => (BlockId)_blocks[index];

        public int WorldX(int localX) => Coord.X * Size + localX;
        public int WorldZ(int localZ) => Coord.Z * Size + localZ;
    }
}
