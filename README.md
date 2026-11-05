# Voxel Valley

블록으로 이루어진 계곡을 함께 탐험하고, 캐고, 쌓는 **복셀 샌드박스** 게임. Unity 6 (C#) · Android / iOS / macOS.

모든 그래픽(블록 텍스처, 캐릭터)은 코드로 직접 그린 원본이에요.

## 기능

- 시드 기반 무한 지형: 언덕·산·모래 해변·나무, 청크(16×64×16) 스트리밍
- 1인칭 이동·점프·충돌, 블록 캐기/놓기(9종), 선택 하이라이트
- 조작: **PC** WASD·마우스·좌클릭 캐기·우클릭 놓기·1~9/휠 / **모바일** 가상 조이스틱·화면 드래그 시점·점프/캐기/놓기 버튼
- **멀티플레이**(Netcode for GameObjects): 한 명이 방을 만들고 같은 와이파이의 친구가 방 주소(IP)로 참가.
  서버가 모든 블록 편집을 검증(거리·플레이어 위치·기반암)하고 모두에게 전파
- 월드 저장: 방장의 기기에 시드 + 편집 내역 자동 저장(30초마다, 나갈 때)

## 구조

| 경로 | 설명 |
|---|---|
| `Assets/Scripts/Core` | 엔진 독립 로직: 블록, 노이즈, 지형 생성, 청크 메쉬, 편집 기록·저장, 편집 규칙 |
| `Assets/Scripts/Runtime` | Unity: 월드 스트리밍, 플레이어, 입력/터치, UI, 네트워크 |
| `Assets/Scripts/Editor` | 프로젝트 설정·씬·프리팹 생성(`ProjectSetup`), 빌드(`BuildScript`) |
| `Assets/Shaders` | 복셀/단색 셰이더 |
| `Assets/Tests/EditMode` | Core 단위 테스트 |

씬과 프리팹은 직접 편집하지 않고 `Tools > Voxel Valley > Setup Project`(또는 빌드 시 자동)로 생성해요.

## 빌드 & 테스트 (커맨드라인)

```bash
UNITY=/Applications/Unity/Hub/Editor/6000.3.28f1/Unity.app/Contents/MacOS/Unity

# 테스트
$UNITY -batchmode -nographics -projectPath . -runTests -testPlatform EditMode -testResults TestResults.xml

# Android APK → Build/Android/VoxelValley.apk
$UNITY -batchmode -quit -projectPath . -executeMethod VoxelValley.EditorTools.BuildScript.Android

# macOS 앱 → Build/macOS/VoxelValley.app
$UNITY -batchmode -quit -projectPath . -executeMethod VoxelValley.EditorTools.BuildScript.MacOS

# iOS Xcode 프로젝트 → Build/iOS (Xcode로 열어 서명·설치)
$UNITY -batchmode -quit -projectPath . -executeMethod VoxelValley.EditorTools.BuildScript.IOS
```

## 같이 하기

1. 한 명이 **방 만들기** → 화면 왼쪽 위에 `방 주소: 192.168.x.x`가 보여요.
2. 같은 와이파이의 친구가 그 주소를 입력하고 **참가**.

포트 UDP 7777을 사용해요. 다른 네트워크 간 접속은 아직 지원하지 않아요(릴레이 서버 필요).
