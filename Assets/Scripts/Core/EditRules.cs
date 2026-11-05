using System;

namespace VoxelValley.Core
{
    public readonly struct Vec3
    {
        public readonly float X, Y, Z;
        public Vec3(float x, float y, float z) { X = x; Y = y; Z = z; }
    }

    public enum EditResult
    {
        Ok,
        OutOfWorld,
        TooFar,
        Unbreakable,
        NothingThere,
        Occupied,
        InsidePlayer,
        NotPlaceable,
    }

    /// <summary>
    /// Server-side checks for block edits, shared with the client so it can
    /// avoid sending requests that would be rejected.
    /// </summary>
    public static class EditRules
    {
        public const float Reach = 6f;
        public const float PlayerRadius = 0.3f;
        public const float PlayerHeight = 1.8f;

        /// <param name="eye">The editing player's eye position.</param>
        public static EditResult CanBreak(Vec3 eye, int x, int y, int z, BlockId current)
        {
            if (y < 0 || y >= Chunk.Height) return EditResult.OutOfWorld;
            if (!InReach(eye, x, y, z)) return EditResult.TooFar;
            if (current == BlockId.Air) return EditResult.NothingThere;
            if (!Blocks.Get(current).Breakable) return EditResult.Unbreakable;
            return EditResult.Ok;
        }

        /// <param name="playerFeet">Feet positions of everyone in the world.</param>
        public static EditResult CanPlace(Vec3 eye, int x, int y, int z, BlockId current, BlockId placing,
            Vec3[] playerFeet)
        {
            if (y < 1 || y >= Chunk.Height) return EditResult.OutOfWorld;
            if (!Blocks.IsPlaceable(placing)) return EditResult.NotPlaceable;
            if (!InReach(eye, x, y, z)) return EditResult.TooFar;
            if (current != BlockId.Air) return EditResult.Occupied;
            foreach (var p in playerFeet)
                if (Overlaps(p, x, y, z)) return EditResult.InsidePlayer;
            return EditResult.Ok;
        }

        /// <summary>Distance from the eye to the block's centre, with slack for latency.</summary>
        public static bool InReach(Vec3 eye, int x, int y, int z)
        {
            float dx = x + 0.5f - eye.X, dy = y + 0.5f - eye.Y, dz = z + 0.5f - eye.Z;
            float limit = Reach + 1.5f;
            return dx * dx + dy * dy + dz * dz <= limit * limit;
        }

        /// <summary>Whether a player standing at <paramref name="feet"/> overlaps block (x,y,z).</summary>
        public static bool Overlaps(Vec3 feet, int x, int y, int z)
        {
            const float eps = 0.01f;
            return feet.X + PlayerRadius > x + eps && feet.X - PlayerRadius < x + 1 - eps &&
                   feet.Z + PlayerRadius > z + eps && feet.Z - PlayerRadius < z + 1 - eps &&
                   feet.Y + PlayerHeight > y + eps && feet.Y < y + 1 - eps;
        }
    }
}
