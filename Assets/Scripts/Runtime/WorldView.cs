using System.Collections.Generic;
using UnityEngine;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>
    /// Streams chunks around <see cref="Focus"/>: generates block data, builds
    /// meshes a few per frame (nearest first) and unloads far chunks.
    /// </summary>
    public sealed class WorldView : MonoBehaviour
    {
        public Material Material;
        public Transform Focus;
        public int ViewRadius = 5;
        public int MeshesPerFrame = 2;

        public VoxelWorld World { get; private set; }
        public bool HasWorld => World != null;

        readonly Dictionary<ChunkCoord, ChunkView> _views = new Dictionary<ChunkCoord, ChunkView>();
        readonly HashSet<ChunkCoord> _dirty = new HashSet<ChunkCoord>();
        readonly List<ChunkCoord> _scratch = new List<ChunkCoord>();
        readonly MeshData _meshData = new MeshData();
        ChunkMesher.BlockLookup _lookup;

        public void Initialize(VoxelWorld world)
        {
            Clear();
            World = world;
            _lookup = (x, y, z) => World.GetBlock(x, y, z);
        }

        public void Clear()
        {
            foreach (var v in _views.Values) if (v != null) Destroy(v.gameObject);
            _views.Clear();
            _dirty.Clear();
            World = null;
        }

        public static Vector3Int ToBlock(Vector3 p) =>
            new Vector3Int(Mathf.FloorToInt(p.x), Mathf.FloorToInt(p.y), Mathf.FloorToInt(p.z));

        /// <summary>True once the chunk under <paramref name="p"/> has a collider.</summary>
        public bool IsReadyAt(Vector3 p)
        {
            var b = ToBlock(p);
            return World != null && _views.TryGetValue(ChunkCoord.FromBlock(b.x, b.z), out var v) && v.HasMesh;
        }

        public BlockId GetBlock(Vector3Int b) => World?.GetBlock(b.x, b.y, b.z) ?? BlockId.Air;

        /// <summary>Applies an edit and rebuilds affected meshes right away.</summary>
        public void SetBlock(int x, int y, int z, BlockId id)
        {
            if (World == null) return;
            World.SetBlock(x, y, z, id);
            int lx = ChunkCoord.Mod(x, Chunk.Size), lz = ChunkCoord.Mod(z, Chunk.Size);
            var c = ChunkCoord.FromBlock(x, z);
            Rebuild(c);
            if (lx == 0) Rebuild(new ChunkCoord(c.X - 1, c.Z));
            if (lx == Chunk.Size - 1) Rebuild(new ChunkCoord(c.X + 1, c.Z));
            if (lz == 0) Rebuild(new ChunkCoord(c.X, c.Z - 1));
            if (lz == Chunk.Size - 1) Rebuild(new ChunkCoord(c.X, c.Z + 1));
        }

        void Rebuild(ChunkCoord c)
        {
            if (_views.ContainsKey(c)) BuildMesh(c);
        }

        void Update()
        {
            if (World == null || Focus == null) return;
            var fb = ToBlock(Focus.position);
            var center = ChunkCoord.FromBlock(fb.x, fb.z);

            // Missing meshes within the view radius, nearest first.
            _scratch.Clear();
            for (int dx = -ViewRadius; dx <= ViewRadius; dx++)
            for (int dz = -ViewRadius; dz <= ViewRadius; dz++)
            {
                if (dx * dx + dz * dz > ViewRadius * ViewRadius + 1) continue;
                var c = new ChunkCoord(center.X + dx, center.Z + dz);
                if (!_views.ContainsKey(c)) _scratch.Add(c);
            }
            _scratch.Sort((a, b) => Dist2(a, center).CompareTo(Dist2(b, center)));
            for (int i = 0; i < _scratch.Count && i < MeshesPerFrame; i++)
            {
                _views[_scratch[i]] = ChunkView.Create(_scratch[i], Material, transform);
                BuildMesh(_scratch[i]);
            }

            // Unload far chunks (edits live on in World.Edits).
            _scratch.Clear();
            int unload = ViewRadius + 2;
            foreach (var c in _views.Keys)
                if (Dist2(c, center) > unload * unload) _scratch.Add(c);
            foreach (var c in _scratch)
            {
                Destroy(_views[c].gameObject);
                _views.Remove(c);
            }
            _scratch.Clear();
            foreach (var c in World.LoadedChunks)
                if (Dist2(c, center) > (unload + 1) * (unload + 1)) _scratch.Add(c);
            foreach (var c in _scratch) World.Unload(c);
        }

        void BuildMesh(ChunkCoord c)
        {
            var chunk = World.GetOrCreateChunk(c);
            ChunkMesher.Build(chunk, _lookup, _meshData);
            _views[c].Apply(_meshData);
        }

        static int Dist2(ChunkCoord a, ChunkCoord b)
        {
            int dx = a.X - b.X, dz = a.Z - b.Z;
            return dx * dx + dz * dz;
        }
    }
}
