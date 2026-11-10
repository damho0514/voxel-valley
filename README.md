# Voxel Valley Go

블록으로 이루어진 세계를 캐고 쌓는 **복셀 샌드박스**예요. Expo(React Native)와 three.js로 만들었어요.

- **계절별 계곡:** 봄·여름·가을·겨울마다 지형, 블록, 하늘, 날씨가 달라요.
- **차원 문:** 미래 도시(하늘을 나는 자동차, 로봇)와 무중력 우주(블랙홀)로 갈 수 있어요.
- **전투와 생물:** 용 소환과 지형 파괴, 용암과 HP, 무기, 길들일 수 있는 동물 펫이 있어요.
- **친구와 같이 하기:** 방 코드로 들어가요. 서버는 Cloudflare Worker예요(`server/`).
- **조작:** 조이스틱 두 개, 자동 점프, 터치한 곳에 놓기와 길게 눌러 캐기, 진동 피드백.

## 실행

```bash
npm install
npx expo start --web      # 브라우저
npx expo prebuild --platform ios   # 아이폰용 네이티브 빌드 (Xcode)
```

## 구조

| 경로 | 설명 |
|---|---|
| `src/game/` | 블록, 노이즈, 지형과 차원 생성, 메쉬, 물리, 봇과 동물, 저장 |
| `src/render/` | three.js 렌더러, 절차적 텍스처, 하늘, 효과, 용, 블랙홀 |
| `src/audio/sound.ts` | 효과음과 배경음악 재생 |
| `src/screens/PlayScreen.tsx` | 게임 루프와 HUD |
| `src/ui/controls.tsx` | 조이스틱과 터치 패드 |
| `server/` | 멀티플레이 방 서버 (Cloudflare Durable Object) |
| `tools/` | 효과음, 음악, 아이콘을 만드는 생성 스크립트 |

## 독자 제작 기록

이 게임의 코드, 그림, 소리는 모두 이 저장소 안에서 직접 만들었어요. 다른 게임의 에셋, 코드, 이름은 쓰지 않았어요.

| 에셋 | 만드는 방법 |
|---|---|
| 블록 텍스처 | `src/render/textures.ts`가 코드로 생성해요. 이미지 파일은 없어요. |
| 효과음과 배경음악 (23개) | `tools/gen_sounds.py`가 사인파와 노이즈로 합성해요. 멜로디와 화음도 직접 만들었어요. |
| 앱 아이콘과 스플래시 | `tools/gen_icons.mjs`가 SVG 도형으로 그려요. 원본 SVG는 `tools/icons/`에 있어요. |
| 3D 모델 (용, 동물, 로봇, 자동차) | `src/render/`의 three.js 기본 도형으로 조립해요. |
| 블록과 생물 이름 | 직접 지은 이름이에요 (이끼, 흙, 점토 등). |

에셋을 다시 만들 때는 아래 명령을 써요.

```bash
python3 tools/gen_sounds.py
PLAYWRIGHT=<playwright 패키지 경로> node tools/gen_icons.mjs
```

이 프로젝트는 다른 게임 회사와 제휴하거나 승인을 받은 공식 제품이 아니에요.

## 오픈소스 라이선스

앱에 들어가는 주요 라이브러리는 모두 MIT 라이선스예요. three.js, React, React Native, Expo 모듈, react-native-gesture-handler, AsyncStorage가 여기에 해당해요. 스토어에 배포할 때는 각 라이브러리의 저작권 고지를 앱 안이나 함께 배포하는 문서에 넣어야 해요.

이 프로젝트의 코드는 MIT 라이선스예요. 자세한 내용은 `LICENSE`를 보세요.
