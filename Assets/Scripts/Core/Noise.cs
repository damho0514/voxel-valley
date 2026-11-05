namespace VoxelValley.Core
{
    /// <summary>
    /// Deterministic 2D value noise built on integer hashing, so every
    /// platform generates identical terrain from the same seed.
    /// </summary>
    public sealed class Noise
    {
        readonly uint _seed;

        public Noise(int seed) { _seed = (uint)seed; }

        /// <summary>Hash of an integer lattice point to [0, 1).</summary>
        public float Hash01(int x, int z, uint salt = 0)
        {
            unchecked
            {
                uint h = _seed ^ (salt * 0x9E3779B9u);
                h ^= (uint)x * 0x85EBCA6Bu;
                h = (h << 13) | (h >> 19);
                h ^= (uint)z * 0xC2B2AE35u;
                h *= 0x27D4EB2Fu;
                h ^= h >> 15;
                h *= 0x165667B1u;
                h ^= h >> 13;
                return (h & 0xFFFFFF) / 16777216f;
            }
        }

        /// <summary>Smooth value noise in [0, 1).</summary>
        public float Value(float x, float z, uint salt = 0)
        {
            int x0 = FloorToInt(x), z0 = FloorToInt(z);
            float fx = x - x0, fz = z - z0;
            float u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
            float a = Hash01(x0, z0, salt), b = Hash01(x0 + 1, z0, salt);
            float c = Hash01(x0, z0 + 1, salt), d = Hash01(x0 + 1, z0 + 1, salt);
            return Lerp(Lerp(a, b, u), Lerp(c, d, u), v);
        }

        /// <summary>Fractal sum of octaves, normalised to [0, 1).</summary>
        public float Fractal(float x, float z, int octaves, uint salt = 0)
        {
            float sum = 0, amp = 1, norm = 0, freq = 1;
            for (int i = 0; i < octaves; i++)
            {
                sum += Value(x * freq, z * freq, salt + (uint)i * 31u) * amp;
                norm += amp;
                amp *= 0.5f;
                freq *= 2f;
            }
            return sum / norm;
        }

        public static int FloorToInt(float v)
        {
            int i = (int)v;
            return v < i ? i - 1 : i;
        }

        static float Lerp(float a, float b, float t) => a + (b - a) * t;
    }
}
