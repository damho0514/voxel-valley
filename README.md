# Voxel Valley Go

블록으로 이루어진 계곡을 캐고 쌓는 **복셀 샌드박스** — Expo(React Native) + three.js 버전.
iPhone/Android의 **Expo Go** 앱에서 바로 실행돼요(Apple 유료 계정·케이블 불필요).

- 파스텔 톤의 매끈한 블록 스타일(픽셀 텍스처 없음), 부드러운 음영(AO)
- 시드 기반 지형: 언덕·호수·모래 해변·둥근 나무, 청크 스트리밍
- 1인칭 이동·점프·수영·충돌, 블록 캐기(꾹 누르기)·놓기, 인벤토리, 낮과 밤
- 조작: 가상 조이스틱 · 화면 드래그 시점 · 캐기/놓기/점프 버튼 · 핫바 (웹은 WASD, F 캐기, E 놓기, 1~9)
- 진행 상황 자동 저장(AsyncStorage)

## 실행

```bash
npm install
npx expo start            # Expo Go로 QR 스캔 (같은 Wi-Fi)
npx expo start --tunnel   # 다른 네트워크에서도 (iPhone은 Expo 계정 로그인 필요)
npx expo start --web      # 브라우저
```

`exp://.../--/?autostart=1` 링크는 시작 화면을 건너뛰고 바로 게임에 들어가요.

## 구조

| 경로 | 설명 |
|---|---|
| `src/game/` | 블록, 노이즈, 월드/지형, 메쉬(AO), 물리, 레이캐스트, 인벤토리, 저장 |
| `src/render/renderer.ts` | expo-gl 위의 three.js, 청크 스트리밍, 낮밤 |
| `src/ui/controls.tsx` | 조이스틱, 시점 패드, 홀드 버튼 (react-native-gesture-handler v3) |
| `App.tsx` | 시작 화면, 게임 루프, HUD |
