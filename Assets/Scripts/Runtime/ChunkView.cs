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
        Mesh _mesh;
        MeshCollider _collider;
        MeshRenderer _renderer;

        static readonly List<Vector3> Verts = new List<Vector3>();
        static readonly List<Vector2> Uvs = new List<Vector2>();
        static readonly List<Color32> Colors = new List<Color32>();

        public ChunkCoord Coord { get; private set; }
        public bool HasMesh { get; private set; }

        public static ChunkView Create(ChunkCoord coord, Material material, Transform parent)
        {
            var go = new GameObject($"Chunk {coord}");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(coord.X * Chunk.Size, 0, coord.Z * Chunk.Size);
            var view = go.AddComponent<ChunkView>();
            view.Coord = coord;
            view._renderer = go.GetComponent<MeshRenderer>();
            view._renderer.sharedMaterial = material;
            view._renderer.shadowCastingMode = ShadowCastingMode.Off;
            view._renderer.receiveShadows = false;
            view._collider = go.GetComponent<MeshCollider>();
            view._mesh = new Mesh { name = go.name, indexFormat = IndexFormat.UInt32 };
            view._mesh.MarkDynamic();
            go.GetComponent<MeshFilter>().sharedMesh = view._mesh;
            return view;
        }

        public void Apply(MeshData data)
        {
            Verts.Clear(); Uvs.Clear(); Colors.Clear();
            for (int i = 0; i < data.VertexCount; i++)
            {
                Verts.Add(new Vector3(data.Positions[i * 3], data.Positions[i * 3 + 1], data.Positions[i * 3 + 2]));
                Uvs.Add(new Vector2(data.Uvs[i * 2], data.Uvs[i * 2 + 1]));
                byte s = (byte)(data.Shades[i] * 255);
                Colors.Add(new Color32(s, s, s, 255));
            }
            _mesh.Clear();
            _mesh.SetVertices(Verts);
            _mesh.SetUVs(0, Uvs);
            _mesh.SetColors(Colors);
            _mesh.SetTriangles(data.Triangles, 0, false);
            _mesh.RecalculateBounds();

            bool any = data.VertexCount > 0;
            _renderer.enabled = any;
            _collider.sharedMesh = null;
            if (any) _collider.sharedMesh = _mesh;
            _collider.enabled = any;
            HasMesh = true;
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
        }
    }
}
