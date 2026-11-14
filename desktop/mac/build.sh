#!/bin/bash
# Builds "Voxel Valley.app" (universal: Apple silicon + Intel) next to this script.
#   ./build.sh            → build only
#   ./build.sh install    → also copy into /Applications
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(cd ../.. && pwd)
APP="build/Voxel Valley.app"
VERSION=$(node -p "require('$ROOT/app.json').expo.version")

rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/obj
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" -o "build/obj/vv-$arch" main.swift
done
lipo -create build/obj/vv-arm64 build/obj/vv-x86_64 -output "$APP/Contents/MacOS/VoxelValley"

# icon: the game's 1024px icon → .icns
SET=build/obj/AppIcon.iconset; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/assets/icon.png" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/assets/icon.png" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Voxel Valley</string>
  <key>CFBundleDisplayName</key><string>Voxel Valley</string>
  <key>CFBundleIdentifier</key><string>io.github.damho0514.voxelvalley</string>
  <key>CFBundleExecutable</key><string>VoxelValley</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>© damho0514</string>
  <key>NSCameraUsageDescription</key><string>내 공간 사진을 찍어 방으로 꾸밀 때 카메라를 사용해요.</string>
  <key>NSMicrophoneUsageDescription</key><string>친구 캐릭터와 말로 대화할 때 마이크를 사용해요.</string>
</dict></plist>
PLIST

codesign --force --deep --sign - "$APP"
echo "built: $(pwd)/$APP"

if [ "${1:-}" = install ]; then
  rm -rf "/Applications/Voxel Valley.app"
  cp -R "$APP" /Applications/
  echo "installed: /Applications/Voxel Valley.app"
fi
