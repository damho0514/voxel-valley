using UnityEngine;

namespace VoxelValley
{
    /// <summary>
    /// A small explorer robot built from boxes: round-ish visor head with an
    /// antenna, coloured body and swinging legs. Shown for other players.
    /// </summary>
    public sealed class PlayerAvatar : MonoBehaviour
    {
        public static readonly Color[] Palette =
        {
            new Color(0.95f, 0.45f, 0.25f), new Color(0.26f, 0.6f, 0.96f), new Color(0.67f, 0.28f, 0.74f),
            new Color(1f, 0.79f, 0.16f), new Color(0.15f, 0.65f, 0.6f), new Color(0.93f, 0.25f, 0.48f),
        };

        Transform _legL, _legR, _label;
        Renderer[] _bodyParts;
        TextMesh _name;
        Vector3 _lastPos;
        float _phase;
        static MaterialPropertyBlock _mpb;

        public static PlayerAvatar Build(Transform player, Material material)
        {
            var root = new GameObject("Avatar").transform;
            root.SetParent(player, false);
            var a = root.gameObject.AddComponent<PlayerAvatar>();

            Box(root, "Torso", new Vector3(0, 0.95f, 0), new Vector3(0.5f, 0.55f, 0.3f), material, true);
            Box(root, "Head", new Vector3(0, 1.45f, 0), new Vector3(0.48f, 0.42f, 0.42f), material, false, new Color(0.92f, 0.92f, 0.95f));
            Box(root, "Visor", new Vector3(0, 1.47f, 0.2f), new Vector3(0.38f, 0.18f, 0.04f), material, false, new Color(0.1f, 0.12f, 0.18f));
            Box(root, "Antenna", new Vector3(0, 1.75f, 0), new Vector3(0.05f, 0.18f, 0.05f), material, false, new Color(0.3f, 0.3f, 0.35f));
            Box(root, "AntennaTip", new Vector3(0, 1.86f, 0), new Vector3(0.1f, 0.1f, 0.1f), material, true);
            Box(root, "ArmL", new Vector3(-0.32f, 0.95f, 0), new Vector3(0.12f, 0.5f, 0.14f), material, false, new Color(0.85f, 0.85f, 0.9f));
            Box(root, "ArmR", new Vector3(0.32f, 0.95f, 0), new Vector3(0.12f, 0.5f, 0.14f), material, false, new Color(0.85f, 0.85f, 0.9f));
            a._legL = Leg(root, -0.12f, material);
            a._legR = Leg(root, 0.12f, material);

            var label = new GameObject("Name");
            label.transform.SetParent(root, false);
            label.transform.localPosition = new Vector3(0, 2.15f, 0);
            a._name = label.AddComponent<TextMesh>();
            a._name.font = UiFactory.Font;
            a._name.GetComponent<MeshRenderer>().sharedMaterial = UiFactory.Font.material;
            a._name.fontSize = 48;
            a._name.characterSize = 0.05f;
            a._name.anchor = TextAnchor.MiddleCenter;
            a._name.alignment = TextAlignment.Center;
            a._name.color = Color.white;
            a._label = label.transform;

            a._bodyParts = new[] { root.Find("Torso").GetComponent<Renderer>(), root.Find("AntennaTip").GetComponent<Renderer>() };
            a._lastPos = player.position;
            return a;
        }

        static Transform Leg(Transform root, float x, Material m)
        {
            var pivot = new GameObject("LegPivot").transform;
            pivot.SetParent(root, false);
            pivot.localPosition = new Vector3(x, 0.68f, 0);
            Box(pivot, "Leg", new Vector3(0, -0.34f, 0), new Vector3(0.16f, 0.68f, 0.18f), m, false, new Color(0.3f, 0.32f, 0.38f));
            return pivot;
        }

        static GameObject Box(Transform parent, string name, Vector3 pos, Vector3 size, Material m, bool tinted, Color? color = null)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.layer = 2;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = size;
            var r = go.GetComponent<Renderer>();
            r.sharedMaterial = m;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            if (!tinted && color.HasValue) SetColor(r, color.Value);
            return go;
        }

        static void SetColor(Renderer r, Color c)
        {
            _mpb ??= new MaterialPropertyBlock();
            _mpb.SetColor("_Color", c);
            r.SetPropertyBlock(_mpb);
        }

        public void SetLook(string nickname, int colorIndex)
        {
            _name.text = string.IsNullOrEmpty(nickname) ? "..." : nickname;
            var c = Palette[Mathf.Abs(colorIndex) % Palette.Length];
            foreach (var r in _bodyParts) SetColor(r, c);
        }

        void LateUpdate()
        {
            var pos = transform.position;
            var flat = new Vector3(pos.x - _lastPos.x, 0, pos.z - _lastPos.z);
            float speed = Time.deltaTime > 0 ? flat.magnitude / Time.deltaTime : 0;
            _lastPos = pos;
            _phase = speed > 0.3f ? _phase + Time.deltaTime * 10f : Mathf.MoveTowards(_phase % Mathf.PI, 0, Time.deltaTime * 6f);
            float swing = Mathf.Sin(_phase) * 35f;
            _legL.localRotation = Quaternion.Euler(swing, 0, 0);
            _legR.localRotation = Quaternion.Euler(-swing, 0, 0);

            var cam = Camera.main;
            if (cam != null) _label.rotation = Quaternion.LookRotation(_label.position - cam.transform.position);
        }
    }
}
