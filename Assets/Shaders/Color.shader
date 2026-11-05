// Flat colour with a simple fixed light, for avatars and the block highlight.
Shader "VoxelValley/Color"
{
    Properties
    {
        _Color ("Color", Color) = (1,1,1,1)
        [Toggle] _Lit ("Lit", Float) = 1
        [Enum(Off,0,On,1)] _ZWrite ("ZWrite", Float) = 1
    }
    SubShader
    {
        Tags { "Queue"="Geometry+10" "RenderType"="Transparent" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite [_ZWrite]
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "UnityCG.cginc"
            float _Daylight; // set globally by the day/night cycle

            fixed4 _Color;
            float _Lit;

            struct appdata { float4 vertex : POSITION; float3 normal : NORMAL; };
            struct v2f { float4 pos : SV_POSITION; float shade : TEXCOORD0; UNITY_FOG_COORDS(1) };

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                float3 n = normalize(UnityObjectToWorldNormal(v.normal));
                float light = 0.65 + 0.35 * saturate(dot(n, normalize(float3(0.4, 1, 0.3))));
                o.shade = lerp(1, light, _Lit);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 c = _Color;
                c.rgb *= i.shade * lerp(1, _Daylight, _Lit);
                UNITY_APPLY_FOG(i.fogCoord, c);
                return c;
            }
            ENDCG
        }
    }
}
