using System;

namespace VoxelValley.Core
{
    /// <summary>Block types. Stored as one byte per voxel.</summary>
    public enum BlockId : byte
    {
        Air = 0,
        Grass = 1,
        Dirt = 2,
        Stone = 3,
        Sand = 4,
        Log = 5,
        Leaves = 6,
        Planks = 7,
        Brick = 8,
        Glass = 9,
        Bedrock = 10,
    }

    /// <summary>Tiles in the 4x4 texture atlas.</summary>
    public enum Tile
    {
        GrassTop = 0, GrassSide = 1, Dirt = 2, Stone = 3,
        Sand = 4, LogSide = 5, LogTop = 6, Leaves = 7,
        Planks = 8, Brick = 9, Glass = 10, Bedrock = 11,
    }

    public readonly struct BlockInfo
    {
        public readonly string Name;
        /// <summary>Hides the faces of neighbours behind it.</summary>
        public readonly bool Opaque;
        /// <summary>Blocks movement and raycasts.</summary>
        public readonly bool Solid;
        public readonly bool Breakable;
        public readonly Tile Top, Side, Bottom;

        public BlockInfo(string name, bool opaque, bool solid, bool breakable, Tile top, Tile side, Tile bottom)
        {
            Name = name; Opaque = opaque; Solid = solid; Breakable = breakable;
            Top = top; Side = side; Bottom = bottom;
        }
    }

    public static class Blocks
    {
        public const int AtlasTilesPerRow = 4;

        static readonly BlockInfo[] Infos = BuildTable();

        static BlockInfo[] BuildTable()
        {
            var t = new BlockInfo[256];
            t[(int)BlockId.Air] = new BlockInfo("공기", false, false, false, 0, 0, 0);
            t[(int)BlockId.Grass] = new BlockInfo("잔디", true, true, true, Tile.GrassTop, Tile.GrassSide, Tile.Dirt);
            t[(int)BlockId.Dirt] = Same("흙", Tile.Dirt);
            t[(int)BlockId.Stone] = Same("돌", Tile.Stone);
            t[(int)BlockId.Sand] = Same("모래", Tile.Sand);
            t[(int)BlockId.Log] = new BlockInfo("통나무", true, true, true, Tile.LogTop, Tile.LogSide, Tile.LogTop);
            t[(int)BlockId.Leaves] = new BlockInfo("나뭇잎", false, true, true, Tile.Leaves, Tile.Leaves, Tile.Leaves);
            t[(int)BlockId.Planks] = Same("판자", Tile.Planks);
            t[(int)BlockId.Brick] = Same("벽돌", Tile.Brick);
            t[(int)BlockId.Glass] = new BlockInfo("유리", false, true, true, Tile.Glass, Tile.Glass, Tile.Glass);
            t[(int)BlockId.Bedrock] = new BlockInfo("기반암", true, true, false, Tile.Bedrock, Tile.Bedrock, Tile.Bedrock);
            return t;
        }

        static BlockInfo Same(string name, Tile tile) => new BlockInfo(name, true, true, true, tile, tile, tile);

        public static BlockInfo Get(BlockId id) => Infos[(int)id];

        public static bool IsKnown(byte id) => id <= (byte)BlockId.Bedrock;

        /// <summary>Blocks a player may place (the hotbar).</summary>
        public static readonly BlockId[] Placeable =
        {
            BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Sand,
            BlockId.Log, BlockId.Planks, BlockId.Brick, BlockId.Glass, BlockId.Leaves,
        };

        public static bool IsPlaceable(BlockId id) => Array.IndexOf(Placeable, id) >= 0;
    }
}
