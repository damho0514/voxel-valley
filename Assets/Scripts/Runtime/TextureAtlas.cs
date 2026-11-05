using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Paints the 4x4 block atlas (16 px tiles) procedurally at startup, so the
    /// game ships no third-party art.
    /// </summary>
    public static class TextureAtlas
    {
        public const int TilePx = 16;
        public const int SizePx = TilePx * Blocks.AtlasTilesPerRow;

        static Texture2D _texture;

        public static Texture2D Texture => _texture != null ? _texture : (_texture = Build());

        /// <summary>UV rect of a tile, for UI icons.</summary>
        public static Rect TileRect(Tile tile)
        {
            int t = (int)tile, n = Blocks.AtlasTilesPerRow;
            float s = 1f / n;
            return new Rect((t % n) * s, 1f - (t / n + 1) * s, s, s);
        }

        static Texture2D Build()
        {
            var tex = new Texture2D(SizePx, SizePx, TextureFormat.RGBA32, false)
            {
                filterMode = FilterMode.Point,
                wrapMode = TextureWrapMode.Clamp,
                name = "VoxelAtlas",
            };
            var px = new Color32[SizePx * SizePx];
            for (int t = 0; t < 12; t++) Paint((Tile)t, px);
            tex.SetPixels32(px);
            tex.Apply(false, false);
            return tex;
        }

        static void Paint(Tile tile, Color32[] px)
        {
            int n = Blocks.AtlasTilesPerRow;
            int ox = ((int)tile % n) * TilePx;
            int oy = (n - 1 - (int)tile / n) * TilePx; // texture rows go bottom-up
            var rng = new Noise(1000 + (int)tile);
            for (int y = 0; y < TilePx; y++)
            for (int x = 0; x < TilePx; x++)
            {
                float r = rng.Hash01(x, y);
                px[(oy + y) * SizePx + ox + x] = Pixel(tile, x, y, r);
            }
        }

        static Color32 Shade(Color32 c, float r, float amount = 0.18f)
        {
            float k = 1f + (r - 0.5f) * 2f * amount;
            return new Color32((byte)Mathf.Clamp(c.r * k, 0, 255), (byte)Mathf.Clamp(c.g * k, 0, 255),
                (byte)Mathf.Clamp(c.b * k, 0, 255), c.a);
        }

        static readonly Color32 Clear = new Color32(0, 0, 0, 0);

        static Color32 Pixel(Tile tile, int x, int y, float r)
        {
            // y = 0 is the bottom row of the tile.
            switch (tile)
            {
                case Tile.GrassTop:
                    return Shade(new Color32(98, 176, 74, 255), r, 0.2f);
                case Tile.GrassSide:
                {
                    int edge = 12 - (int)(r * 2.5f); // ragged turf edge
                    return y >= edge
                        ? Shade(new Color32(98, 176, 74, 255), r, 0.2f)
                        : Shade(new Color32(134, 96, 67, 255), r);
                }
                case Tile.Dirt:
                    return Shade(new Color32(134, 96, 67, 255), r, 0.22f);
                case Tile.Stone:
                {
                    var c = Shade(new Color32(128, 132, 138, 255), r, 0.15f);
                    bool crack = (x + y * 3) % 11 == 0 && r > 0.4f;
                    return crack ? Shade(c, 0.1f, 0.4f) : c;
                }
                case Tile.Sand:
                    return Shade(new Color32(226, 210, 150, 255), r, 0.1f);
                case Tile.LogSide:
                {
                    bool groove = x % 4 == 1;
                    return Shade(groove ? new Color32(92, 64, 40, 255) : new Color32(122, 88, 56, 255), r, 0.12f);
                }
                case Tile.LogTop:
                {
                    float d = Mathf.Sqrt((x - 7.5f) * (x - 7.5f) + (y - 7.5f) * (y - 7.5f));
                    if (d > 7f) return Shade(new Color32(92, 64, 40, 255), r, 0.1f);
                    bool ring = ((int)d) % 3 == 0;
                    return Shade(ring ? new Color32(160, 122, 80, 255) : new Color32(190, 152, 100, 255), r, 0.08f);
                }
                case Tile.Leaves:
                    return r < 0.18f ? Clear : Shade(new Color32(56, 140, 64, 255), r, 0.3f);
                case Tile.Planks:
                {
                    bool seam = y % 4 == 0;
                    bool nail = y % 4 == 2 && (x == 2 || x == 13) && ((y / 4) % 2 == 0);
                    var c = Shade(new Color32(196, 150, 96, 255), r, 0.1f);
                    if (seam) return new Color32(140, 100, 60, 255);
                    return nail ? new Color32(110, 90, 70, 255) : c;
                }
                case Tile.Brick:
                {
                    int row = y / 4;
                    int offset = row % 2 == 0 ? 0 : 4;
                    bool mortar = y % 4 == 0 || (x + offset) % 8 == 0;
                    return mortar ? new Color32(206, 200, 190, 255) : Shade(new Color32(170, 74, 60, 255), r, 0.15f);
                }
                case Tile.Glass:
                {
                    bool frame = x == 0 || y == 0 || x == TilePx - 1 || y == TilePx - 1;
                    bool glint = (x - y == 5 || x - y == 6) && x > 6 && x < 13;
                    if (frame) return new Color32(210, 236, 245, 255);
                    return glint ? new Color32(240, 250, 255, 255) : Clear;
                }
                case Tile.Bedrock:
                    return Shade(new Color32(60, 58, 64, 255), r, 0.45f);
                default:
                    return new Color32(255, 0, 255, 255);
            }
        }
    }
}
