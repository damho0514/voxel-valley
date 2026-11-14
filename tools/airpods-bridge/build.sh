#!/bin/sh
# Builds "VV AirPods.app" (menu-bar AirPods bridge for the web game) next to this script.
# Usage: tools/airpods-bridge/build.sh        then: open "tools/airpods-bridge/build/VV AirPods.app"
set -e
cd "$(dirname "$0")"
APP="build/VV AirPods.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp Info.plist "$APP/Contents/Info.plist"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos14.0" main.swift -o "$APP/Contents/MacOS/AirPodsBridge"
# Ad-hoc signature: enough to run on this Mac and to get the motion-permission prompt.
codesign --force --sign - "$APP"
echo "built: $(pwd)/$APP"
