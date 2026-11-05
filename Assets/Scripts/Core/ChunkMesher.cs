using System;
using System.Collections.Generic;

namespace VoxelValley.Core
{
    /// <summary>Engine-agnostic mesh buffers for one chunk.</summary>
    public sealed class MeshData
    {
        public readonly List<float> Positions = new List<float>(); // x,y,z
        public readonly List<float> Uvs = new List<float>();       // u,v
        public readonly List<float> Shades = new List<float>();    // brightness per vertex
        public readonly List<int> Triangles = new List<int>();

        public int VertexCount => Positions.Count / 3;
        public int FaceCount => VertexCount / 4;

        public void Clear()
        {
            Positions.Clear(); Uvs.Clear(); Shades.Clear(); Triangles.Clear();
        }
    }

    /// <summary>
    /// Builds one quad per visible block face. A face is visible when the
    /// neighbouring block does not hide it (air, or a see-through block of a
    /// different type).
    /// </summary>
    public static class ChunkMesher
    {
        /// <summary>Looks up a block by world coordinates (for chunk borders).</summary>
        public delegate BlockId BlockLookup(int wx, int y, int wz);

        // Face order: +X, -X, +Y, -Y, +Z, -Z
        static readonly int[,] Dirs = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };

        // Four corners per face, counter-clockwise when seen from outside.
        static readonly float[][] Corners =
        {
            new float[] { 1,0,0, 1,1,0, 1,1,1, 1,0,1 },
            new float[] { 0,0,1, 0,1,1, 0,1,0, 0,0,0 },
            new float[] { 0,1,0, 0,1,1, 1,1,1, 1,1,0 },
            new float[] { 0,0,1, 0,0,0, 1,0,0, 1,0,1 },
            new float[] { 1,0,1, 1,1,1, 0,1,1, 0,0,1 },
            new float[] { 0,0,0, 0,1,0, 1,1,0, 1,0,0 },
        };

        static readonly float[] FaceShade = { 0.8f, 0.8f, 1f, 0.55f, 0.7f, 0.7f };

        /// <summary>Half a texel inset to stop neighbouring atlas tiles bleeding in.</summary>
        const float UvInset = 0.5f / 64f;

        /// <summary>Water surface sits a little below the block top.</summary>
        public const float WaterSurface = 0.875f;

        /// <summary>
        /// Builds the solid mesh (rendered + collided) and, if given, the water
        /// mesh (rendered translucent, never collided).
        /// </summary>
        public static MeshData Build(Chunk chunk, BlockLookup outside, MeshData into = null, MeshData water = null)
        {
            var mesh = into ?? new MeshData();
            mesh.Clear();
            water?.Clear();
            for (int y = 0; y < Chunk.Height; y++)
            for (int z = 0; z < Chunk.Size; z++)
            for (int x = 0; x < Chunk.Size; x++)
            {
                var id = chunk.Get(x, y, z);
                if (id == BlockId.Air) continue;
                var info = Blocks.Get(id);
                bool isWater = id == BlockId.Water;
                if (isWater && water == null) continue;
                bool surface = isWater && Neighbour(chunk, outside, x, y + 1, z) != BlockId.Water;
                for (int f = 0; f < 6; f++)
                {
                    int nx = x + Dirs[f, 0], ny = y + Dirs[f, 1], nz = z + Dirs[f, 2];
                    var neighbour = Neighbour(chunk, outside, nx, ny, nz);
                    var tile = f == 2 ? info.Top : f == 3 ? info.Bottom : info.Side;
                    if (isWater)
                    {
                        // Water only shows where it meets open air.
                        if (neighbour == BlockId.Air) AddFace(water, x, y, z, f, tile, surface ? WaterSurface : 1f);
                        continue;
                    }
                    if (!IsFaceVisible(id, neighbour)) continue;
                    AddFace(mesh, x, y, z, f, tile);
                }
            }
            return mesh;
        }

        static BlockId Neighbour(Chunk chunk, BlockLookup outside, int nx, int ny, int nz)
        {
            if (ny < 0 || ny >= Chunk.Height) return BlockId.Air;
            if (Chunk.InBounds(nx, ny, nz)) return chunk.Get(nx, ny, nz);
            return outside(chunk.WorldX(nx), ny, chunk.WorldZ(nz));
        }

        public static bool IsFaceVisible(BlockId self, BlockId neighbour)
        {
            if (neighbour == BlockId.Air) return true;
            var n = Blocks.Get(neighbour);
            if (n.Opaque) return false;
            // Glass next to glass (or leaves next to leaves) shares one face.
            return neighbour != self;
        }

        static void AddFace(MeshData mesh, int x, int y, int z, int face, Tile tile, float height = 1f)
        {
            int start = mesh.VertexCount;
            var c = Corners[face];
            for (int i = 0; i < 4; i++)
            {
                mesh.Positions.Add(x + c[i * 3]);
                mesh.Positions.Add(y + c[i * 3 + 1] * height);
                mesh.Positions.Add(z + c[i * 3 + 2]);
                mesh.Shades.Add(FaceShade[face]);
            }

            int t = (int)tile;
            float size = 1f / Blocks.AtlasTilesPerRow;
            float u0 = (t % Blocks.AtlasTilesPerRow) * size + UvInset;
            float v0 = 1f - (t / Blocks.AtlasTilesPerRow + 1) * size + UvInset;
            float u1 = u0 + size - 2 * UvInset, v1 = v0 + size - 2 * UvInset;
            // Corner order is bottom, top, top, bottom for side faces.
            mesh.Uvs.AddRange(new[] { u0, v0, u0, v1, u1, v1, u1, v0 });

            mesh.Triangles.Add(start); mesh.Triangles.Add(start + 1); mesh.Triangles.Add(start + 2);
            mesh.Triangles.Add(start); mesh.Triangles.Add(start + 2); mesh.Triangles.Add(start + 3);
        }
    }
}
