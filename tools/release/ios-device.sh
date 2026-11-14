#!/bin/bash
# Builds the current commit as a Release app and installs it on the connected iPhone (free signing,
# team 5L947QVG3D). Free-signed apps stop opening after 7 days: re-run this to renew.
# The iPhone must be connected (cable or Wi-Fi tunnel) and unlocked.
set -euo pipefail
APP=$(cd "$(dirname "$0")/../.." && pwd)
WORK="$HOME/.damho-tools/release-work"
TEAM=5L947QVG3D
mkdir -p "$WORK"
cd "$APP"
xcrun devicectl list devices --json-output "$WORK/devices.json" >/dev/null 2>&1 || true
UDID=$(python3 - "$WORK/devices.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
for x in d.get('result',{}).get('devices',[]):
    hp, cp = x.get('hardwareProperties',{}), x.get('connectionProperties',{})
    if hp.get('platform')=='iOS' and cp.get('tunnelState')=='connected':
        print(hp.get('udid','')); break
PY
)
[ -n "$UDID" ] || { echo "✗ no reachable iPhone — connect it by cable and unlock it"; exit 1; }
echo "━━ prebuild ios"
CI=1 npx expo prebuild --clean --platform ios > "$WORK/prebuild-ios.log" 2>&1 || { echo "✗ prebuild failed: $WORK/prebuild-ios.log"; exit 1; }
echo "━━ xcodebuild Release for $UDID"
xcodebuild -workspace ios/VoxelValley.xcworkspace -scheme VoxelValley -configuration Release \
  -destination "id=$UDID" -derivedDataPath "$WORK/ios-dd" DEVELOPMENT_TEAM=$TEAM \
  -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic build > "$WORK/xcodebuild.log" 2>&1 \
  || { echo "✗ build failed: $WORK/xcodebuild.log"; tail -20 "$WORK/xcodebuild.log"; exit 1; }
IOS_APP=$(ls -d "$WORK"/ios-dd/Build/Products/Release-iphoneos/*.app | head -1)
echo "━━ install $IOS_APP"
xcrun devicectl device install app --device "$UDID" "$IOS_APP" > "$WORK/ios-install.log" 2>&1 \
  || { echo "✗ install failed (phone locked?): $WORK/ios-install.log"; tail -5 "$WORK/ios-install.log"; exit 1; }
xcrun devicectl device process launch --device "$UDID" com.damho0514.voxelvalley >/dev/null 2>&1 || true
echo "✓ installed and launched on the iPhone ($(python3 -c "import json;print(json.load(open('app.json'))['expo']['version'])"))"
