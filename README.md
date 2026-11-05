# Voxel Valley

블록으로 이루어진 계곡을 함께 탐험하고, 캐고, 쌓는 **복셀 샌드박스** 게임. Unity 6 (C#) · Android / iOS / macOS.

모든 그래픽(블록 텍스처, 캐릭터)은 코드로 직접 그린 원본이에요.

## 기능

- 시드 기반 무한 지형: 언덕·산·모래 해변·**호수**·나무, 청크(16×64×16) 스트리밍
- 1인칭 이동·점프·충돌·**수영**, 블록 캐기/놓기(9종), 선택 하이라이트
- **서바이벌**: 블록마다 단단함(꾹 눌러 캐기, 진행도 표시), 캔 블록은 인벤토리로(잔디→흙), 놓으면 소모.
  처음엔 판자 16·유리 4. 인벤토리는 서버가 관리하고 닉네임별로 저장
- **낮과 밤**: 10분 주기, 모든 플레이어 동기화(서버 시간 기준), 물속에서는 푸른 안개
- **채팅**: PC Enter/T, 모바일 채팅 버튼. 서버가 정리(80자, 태그 제거)하고 5초에 5회로 제한
- 조작: **PC** WASD·마우스·좌클릭 캐기·우클릭 놓기·1~9/휠 / **모바일** 가상 조이스틱·화면 드래그 시점·점프/캐기/놓기 버튼
- **멀티플레이**(Netcode for GameObjects): 한 명이 방을 만들고 같은 와이파이의 친구가 방 주소(IP)로 참가.
  서버가 모든 블록 편집을 검증(거리·플레이어 위치·기반암·보유 아이템·초당 12회)하고 모두에게 전파
- 월드 저장: 방장의 기기에 시드·시간·편집 내역·플레이어 인벤토리 자동 저장(30초마다, 나갈 때). 이전 v1 저장 파일도 읽음

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

## 명령줄 옵션 (데스크톱 빌드)

```bash
"Build/macOS/VoxelValley.app/Contents/MacOS/Voxel Valley" -host -name 방장 [-time 0.75]   # 바로 방 만들기 (-host-online: 온라인 방) (0=해뜰녘, 0.25=정오, 0.75=자정)
"Build/macOS/VoxelValley.app/Contents/MacOS/Voxel Valley" -join 192.168.0.12 -name 친구
```

`-batchmode -nographics`를 붙이면 화면 없는 호스트로도 돌릴 수 있어요.

## 같이 하기

- **같은 와이파이**: 한 명이 **방 만들기** → 왼쪽 위 `방 주소: 192.168.x.x`를 친구가 입력하고 **참가** (UDP 7777).
- **어디서나(온라인)**: **온라인 방 만들기** → 왼쪽 위 `참가 코드: ABC123`을 친구가 입력하고 **참가**.
  Unity Relay를 사용하며, 프로젝트가 Unity Cloud 프로젝트에 연결돼 있어야 해요
  (`ProjectSettings/ProjectSettings.asset`의 `cloudProjectId`·`organizationId`).
