using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using VoxelValley.Core;

namespace VoxelValley
{
    /// <summary>Renders and collides one chunk.</summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer), typeof(MeshCollider))]
    public sealed class ChunkView : MonoBehaviour
    {
        Mesh _mesh;          // submesh 0: solid, submesh 1: water
        Mesh _colliderMesh;  // solid only
        MeshCollider _collider;
        MeshRenderer _renderer;

        static readonly List<Vector3> Verts = new List<Vector3>();
        static readonly List<Vector2> Uvs = new List<Vector2>();
        static readonly List<Color32> Colors = new List<Color32>();

        public ChunkCoord Coord { get; private set; }
        public bool HasMesh { get; private set; }

        public static ChunkView Create(ChunkCoord coord, Material material, Material water, Transform parent)
        {
            var go = new GameObject($"Chunk {coord}");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(coord.X * Chunk.Size, 0, coord.Z * Chunk.Size);
            var view = go.AddComponent<ChunkView>();
            view.Coord = coord;
            view._renderer = go.GetComponent<MeshRenderer>();
            view._renderer.sharedMaterials = new[] { material, water };
            view._renderer.shadowCastingMode = ShadowCastingMode.Off;
            view._renderer.receiveShadows = false;
            view._collider = go.GetComponent<MeshCollider>();
            view._mesh = new Mesh { name = go.name, indexFormat = IndexFormat.UInt32 };
            view._mesh.MarkDynamic();
            view._colliderMesh = new Mesh { name = go.name + " collider", indexFormat = IndexFormat.UInt32 };
            go.GetComponent<MeshFilter>().sharedMesh = view._mesh;
            return view;
        }

        static readonly List<int> WaterTris = new List<int>();

        public void Apply(MeshData solid, MeshData water)
        {
            Verts.Clear(); Uvs.Clear(); Colors.Clear(); WaterTris.Clear();
            Append(solid);
            int offset = solid.VertexCount;
            Append(water);
            foreach (var t in water.Triangles) WaterTris.Add(t + offset);

            _mesh.Clear();
            _mesh.subMeshCount = 2;
            _mesh.SetVertices(Verts);
            _mesh.SetUVs(0, Uvs);
            _mesh.SetColors(Colors);
            _mesh.SetTriangles(solid.Triangles, 0, false);
            _mesh.SetTriangles(WaterTris, 1, false);
            _mesh.RecalculateBounds();
            _renderer.enabled = Verts.Count > 0;

            // Collide with solid blocks only: players swim through water.
            _colliderMesh.Clear();
            _colliderMesh.SetVertices(Verts.GetRange(0, solid.VertexCount));
            _colliderMesh.SetTriangles(solid.Triangles, 0, false);
            _collider.sharedMesh = null;
            bool any = solid.VertexCount > 0;
            if (any) _collider.sharedMesh = _colliderMesh;
            _collider.enabled = any;
            HasMesh = true;
        }

        static void Append(MeshData data)
        {
            for (int i = 0; i < data.VertexCount; i++)
            {
                Verts.Add(new Vector3(data.Positions[i * 3], data.Positions[i * 3 + 1], data.Positions[i * 3 + 2]));
                Uvs.Add(new Vector2(data.Uvs[i * 2], data.Uvs[i * 2 + 1]));
                byte s = (byte)(data.Shades[i] * 255);
                Colors.Add(new Color32(s, s, s, 255));
            }
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_colliderMesh != null) Destroy(_colliderMesh);
        }
    }
}
