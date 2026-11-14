#!/bin/bash
# Voxel Valley Go — one-command release.
#
# Nothing is published unless every check passes. Then it ships the same build everywhere:
#   web (GitHub Pages /play/, also the iPhone home-screen app), Android (signed APK on GitHub
#   Releases + the /app/ landing page), iOS (Expo Go update channel "production", and the native
#   app on a connected iPhone).
#
#   tools/release/release.sh [--version 1.5.0] [--title "…"] [--notes notes.md] [--verify-only] [--skip-device]
#
# Checks, in order (any failure stops the release and changes nothing):
#   1. clean git tree on main, up to date with origin
#   2. typecheck + lint
#   3. dev smoke: every dimension, third-person camera never inside a block (tools/release/smoke.mjs)
#   4. web export + prod smoke on the exact files that will be published
#   5. Android: release APK build, signed with the private key (not debug), installed and launched
#      on an emulator into the game, no crash
#   6. iOS (Expo Go): the update bundle runs in Expo Go on the iOS simulator without errors
#   7. iOS (native, when an iPhone is connected): Release build signs and compiles
#
# Tools kept outside the repo (never commit them): ~/.damho-tools/{pw,vv-eas-go,release-work,release-logs}.
# Signing keys: ~/.damho-keys (see plugins/withReleaseSigning.js).
set -euo pipefail

APP=$(cd "$(dirname "$0")/../.." && pwd)
HERE="$APP/tools/release"
TOOLS="$HOME/.damho-tools"
WORK="$TOOLS/release-work"
EAS_DIR="$TOOLS/vv-eas-go"
REPO=damho0514/voxel-valley
PAGES=https://damho0514.github.io/voxel-valley
PKG=com.damho0514.voxelvalley
TEAM=5L947QVG3D
SDK="$HOME/Library/Android/sdk"
export PW_DIR="$TOOLS/pw"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
[ -d "$JAVA_HOME" ] || export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$SDK/platform-tools:$SDK/emulator:$PATH"

VERSION="" TITLE="" NOTES="" VERIFY_ONLY=0 SKIP_DEVICE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION=$2; shift 2 ;;
    --title) TITLE=$2; shift 2 ;;
    --notes) NOTES=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --skip-device) SKIP_DEVICE=1; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
done

mkdir -p "$TOOLS/release-logs" "$WORK"
LOG="$TOOLS/release-logs/$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
step() { echo; echo "━━ $* ━━ ($(date +%H:%M:%S))"; }
die() { echo; echo "✗ RELEASE STOPPED: $*"; echo "  log: $LOG"; exit 1; }

# ── One release at a time (several sessions work on this repo).
LOCK="$TOOLS/release.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  die "another release is running (lock $LOCK, since $(stat -f %Sm "$LOCK")). Remove it only if that run is dead."
fi
echo $$ > "$LOCK/pid"
PIDS=() BOOTED_EMU=0 BUMPED=0
cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  [ "$BOOTED_EMU" = 1 ] && adb -s "${EMU_SERIAL:-emulator-5554}" emu kill >/dev/null 2>&1 || true
  if [ "$BUMPED" = 1 ]; then (cd "$APP" && git checkout -- app.json) || true; fi
  rm -rf "$LOCK"
}
trap cleanup EXIT
wait_http() { for _ in $(seq 1 ${2:-90}); do curl -s -o /dev/null --max-time 2 "$1" && return 0; sleep 2; done; return 1; }

cd "$APP"
export GH_TOKEN=$(gh auth token --user damho0514)

# ═══════════════════════════════ 1. preflight ═══════════════════════════════
step "1/7 preflight"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main"
git fetch -q origin
[ "$(git rev-list --count HEAD..origin/main)" = 0 ] || die "main is behind origin/main — pull first"
DIRTY=$(git status --porcelain)
[ -z "$DIRTY" ] || die "uncommitted changes (commit or finish them first):
$DIRTY"
CUR=$(python3 -c "import json;print(json.load(open('app.json'))['expo']['version'])")
CODE=$(python3 -c "import json;print(json.load(open('app.json'))['expo']['android']['versionCode'])")
if [ -z "$VERSION" ]; then VERSION=$(python3 -c "v='$CUR'.split('.');v[-1]=str(int(v[-1])+1);print('.'.join(v))"); fi
NEWCODE=$((CODE + 1))
TAG="v$VERSION"
if [ "$VERIFY_ONLY" = 0 ]; then
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"
  gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 && die "release $TAG already exists"
fi
echo "  $CUR ($CODE) → $VERSION ($NEWCODE)   commit $(git rev-parse --short HEAD)"

# ═══════════════════════════════ 2. static checks ═══════════════════════════════
step "2/7 typecheck + lint"
npx tsc --noEmit || die "typecheck failed"
LINT=$(npx expo lint 2>&1) || true
echo "$LINT" | tail -3
echo "$LINT" | grep -qE "✖ [0-9]+ problems? \([1-9][0-9]* error" && die "lint errors"

# ═══════════════════════════════ 3. dev smoke ═══════════════════════════════
step "3/7 dev smoke (every dimension, third-person camera)"
rm -rf "$WORK/shots"
CI=1 npx expo start --web --port 8160 > "$WORK/metro-dev.log" 2>&1 &
PIDS+=($!)
wait_http http://localhost:8160/ || die "dev server did not start (see $WORK/metro-dev.log)"
node "$HERE/smoke.mjs" dev "http://localhost:8160/" "$WORK/shots" || die "dev smoke failed (screens in $WORK/shots)"
kill "${PIDS[-1]}" 2>/dev/null || true

# Version bump (in the working tree; committed only if everything passes).
python3 - "$VERSION" "$NEWCODE" <<'PY'
import json,sys
d=json.load(open('app.json'))
d['expo']['version']=sys.argv[1]; d['expo']['android']['versionCode']=int(sys.argv[2])
d['expo'].setdefault('ios',{})['buildNumber']=sys.argv[2]
json.dump(d,open('app.json','w'),ensure_ascii=False,indent=2); open('app.json','a').write('\n')
PY
BUMPED=1

# ═══════════════════════════════ 4. web build ═══════════════════════════════
step "4/7 web export + prod smoke"
cp app.json "$WORK/app.json.release"
python3 - <<'PY'
import json
d=json.load(open('app.json'))
d['expo'].setdefault('experiments',{})['baseUrl']='/voxel-valley/play'
json.dump(d,open('app.json','w'),ensure_ascii=False,indent=2)
PY
rm -rf "$WORK/web"
CI=1 npx expo export --platform web --output-dir "$WORK/web" > "$WORK/web-export.log" 2>&1 \
  || { cp "$WORK/app.json.release" app.json; die "web export failed (see $WORK/web-export.log)"; }
cp "$WORK/app.json.release" app.json
cp "$HERE/webtpl/"{manifest.json,icon-180.png,icon-192.png,icon-512.png} "$WORK/web/"
python3 - "$WORK/web/index.html" "$HERE/webtpl/index.html" <<'PY'
import re,sys
new=open(sys.argv[1]).read(); tpl=open(sys.argv[2]).read()
scripts=re.findall(r'<script src="[^"]+" defer></script>', new)
assert scripts, 'no bundle script in export'
out=re.sub(r'<script src="/voxel-valley/play/_expo/[^"]+" defer></script>', lambda m: '\n'.join(scripts), tpl, count=1)
assert out!=tpl, 'template has no bundle script to replace'
open(sys.argv[1],'w').write(out)
PY
BUNDLE=$(grep -o 'index-[0-9a-f]*\.js' "$WORK/web/index.html" | head -1)
rm -rf "$WORK/site" && mkdir -p "$WORK/site/voxel-valley" && cp -R "$WORK/web" "$WORK/site/voxel-valley/play"
(cd "$WORK/site" && exec python3 -m http.server 8161 >/dev/null 2>&1) &
PIDS+=($!)
wait_http http://localhost:8161/voxel-valley/play/ 30 || die "local web server did not start"
node "$HERE/smoke.mjs" prod "http://localhost:8161/voxel-valley/play/" "$WORK/shots" || die "prod smoke failed"
echo "  bundle $BUNDLE"

# ═══════════════════════════════ 5. Android ═══════════════════════════════
step "5/7 Android release APK"
CI=1 npx expo prebuild --clean --platform android --no-install > "$WORK/prebuild-android.log" 2>&1 || die "android prebuild failed"
echo "sdk.dir=$SDK" > android/local.properties
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --no-daemon -q > "$WORK/gradle.log" 2>&1) \
  || die "gradle assembleRelease failed (see $WORK/gradle.log)"
APK="$APP/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || die "no APK at $APK"
cp "$APK" "$WORK/VoxelValley.apk"
APKSIGNER=$(ls "$SDK"/build-tools/*/apksigner | tail -1)
CERT=$("$APKSIGNER" verify --print-certs "$WORK/VoxelValley.apk" 2>&1) || die "APK signature does not verify"
echo "$CERT" | grep -q "Android Debug" && die "APK is signed with the DEBUG key"
echo "  signed: $(echo "$CERT" | grep -m1 'certificate DN' | cut -c1-90)"
echo "  size: $(du -h "$WORK/VoxelValley.apk" | cut -f1)"

EMU_SERIAL=$(adb devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')
if [ -z "$EMU_SERIAL" ]; then
  echo "  booting emulator vvtest…"
  emulator -avd vvtest -no-window -no-audio -no-snapshot-save -no-boot-anim > "$WORK/emulator.log" 2>&1 &
  BOOTED_EMU=1
  for _ in $(seq 1 120); do
    EMU_SERIAL=$(adb devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')
    [ -n "$EMU_SERIAL" ] && [ "$(adb -s "$EMU_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
    sleep 3
  done
  [ -n "$EMU_SERIAL" ] || die "emulator did not boot (see $WORK/emulator.log)"
fi
A="adb -s $EMU_SERIAL"
$A install -r "$WORK/VoxelValley.apk" > "$WORK/adb-install.log" 2>&1 || {
  grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE\|signatures do not match" "$WORK/adb-install.log" && $A uninstall "$PKG" >/dev/null 2>&1
  $A install -r "$WORK/VoxelValley.apk" >> "$WORK/adb-install.log" 2>&1 || die "APK install failed (see $WORK/adb-install.log)"
}
$A logcat -c; $A logcat -b crash -c 2>/dev/null || true
$A shell am force-stop "$PKG"
$A shell "am start -a android.intent.action.VIEW -d 'voxelvalley://open?autostart=1' $PKG" >/dev/null
sleep 35
APID=$($A shell pidof "$PKG" | tr -d '\r')
CRASH=$($A logcat -d -b crash 2>/dev/null | grep -A5 "$PKG" || true)
FATAL=$($A logcat -d | grep -E "FATAL EXCEPTION|ReactNativeJS.*(Error|Exception)" | head -5 || true)
$A shell screencap -p > "$WORK/shots/android-play.png" 2>/dev/null || true
[ -n "$APID" ] || die "app is not running 35 s after launch
$CRASH"
[ -z "$CRASH$FATAL" ] || die "app crashed / threw on Android:
$CRASH
$FATAL"
echo "  ✓ running in the game on $EMU_SERIAL (pid $APID), no crashes"
if [ "$BOOTED_EMU" = 1 ]; then $A emu kill >/dev/null 2>&1 || true; BOOTED_EMU=0; fi

# ═══════════════════════════════ 6. iOS: Expo Go ═══════════════════════════════
step "6/7 iOS Expo Go bundle on the simulator"
# The Expo Go update is published from a separate copy (expo-updates + runtimeVersion), so the
# native builds in this repo stay untouched. Sync the code, keep that copy's update settings.
rsync -a --delete "$APP/src/" "$EAS_DIR/src/"
rsync -a --delete "$APP/assets/" "$EAS_DIR/assets/"
rsync -a --delete "$APP/modules/" "$EAS_DIR/modules/"
rsync -a --delete "$APP/patches/" "$EAS_DIR/patches/"
mkdir -p "$EAS_DIR/server" && rsync -a --delete "$APP/server/src/" "$EAS_DIR/server/src/"
cp "$APP/App.tsx" "$APP/index.ts" "$APP/tsconfig.json" "$EAS_DIR/"
python3 - "$APP/package.json" "$EAS_DIR/package.json" "$APP/app.json" "$EAS_DIR/app.json" <<'PY'
import json,sys
src=json.load(open(sys.argv[1])); dst=json.load(open(sys.argv[2]))
keep=dst['dependencies'].get('expo-updates')
dst['dependencies']=dict(src['dependencies']);
if keep: dst['dependencies']['expo-updates']=keep
dst['devDependencies']=src.get('devDependencies',{})
json.dump(dst,open(sys.argv[2],'w'),indent=2); open(sys.argv[2],'a').write('\n')
a=json.load(open(sys.argv[3]))['expo']; b=json.load(open(sys.argv[4]))
for k in ('name','slug','version','orientation','icon','splash','userInterfaceStyle','scheme','plugins','web','experiments'):
    if k in a: b['expo'][k]=a[k]
    elif k in b['expo']: del b['expo'][k]
# Expo Go can't run config plugins that need a native build; they don't matter for an update.
b['expo'].pop('plugins',None)
b['expo'].get('experiments',{}).pop('baseUrl',None)
json.dump(b,open(sys.argv[4],'w'),ensure_ascii=False,indent=2)
PY
(cd "$EAS_DIR" && npm install --no-audit --no-fund > "$WORK/eas-npm.log" 2>&1) || die "npm install in the Expo Go copy failed (see $WORK/eas-npm.log)"
SIM=$(for d in "$HOME"/Library/Developer/CoreSimulator/Devices/*/; do ls -d "$d"data/Containers/Bundle/Application/*/Expo*.app >/dev/null 2>&1 && basename "$d" && break; done)
[ -n "$SIM" ] || die "no iOS simulator with Expo Go installed"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null 2>&1 || true
(cd "$EAS_DIR" && CI=1 exec npx expo start --go --port 8170 > "$WORK/metro-go.log" 2>&1) &
PIDS+=($!)
wait_http http://localhost:8170/ || die "Expo Go dev server did not start (see $WORK/metro-go.log)"
xcrun simctl terminate "$SIM" host.exp.Exponent >/dev/null 2>&1 || true
xcrun simctl openurl "$SIM" "exp://127.0.0.1:8170/--/?autostart=1"
for _ in $(seq 1 60); do grep -q "Bundled\|Bundling.*100" "$WORK/metro-go.log" && break; sleep 3; done
sleep 40 # into the game: the play screen is a second, lazily loaded bundle
GOERR=$(grep -E "ERROR|Error:|Invariant|Cannot find native module|Unable to resolve" "$WORK/metro-go.log" | grep -v "WARN" | head -8 || true)
grep -q "Bundled\|Bundling.*100" "$WORK/metro-go.log" || die "Expo Go never finished bundling (see $WORK/metro-go.log)"
[ -z "$GOERR" ] || die "errors running in Expo Go:
$GOERR"
echo "  ✓ Expo Go on the simulator: bundled, into the game, no errors"
kill "${PIDS[-1]}" 2>/dev/null || true

# ═══════════════════════════════ 7. iOS: native ═══════════════════════════════
DEVICE_UDID=""
if [ "$SKIP_DEVICE" = 0 ]; then
  DEVICE_UDID=$(xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for x in d.get('result',{}).get('devices',[]):
    if x.get('connectionProperties',{}).get('tunnelState')=='connected' or x.get('connectionProperties',{}).get('pairingState')=='paired':
        print(x.get('hardwareProperties',{}).get('udid','')); break" 2>/dev/null || true)
fi
if [ -n "$DEVICE_UDID" ]; then
  step "7/7 iOS native Release build for the connected iPhone"
  CI=1 npx expo prebuild --clean --platform ios > "$WORK/prebuild-ios.log" 2>&1 || die "ios prebuild failed (see $WORK/prebuild-ios.log)"
  xcodebuild -workspace ios/VoxelValley.xcworkspace -scheme VoxelValley -configuration Release \
    -destination "id=$DEVICE_UDID" -derivedDataPath "$WORK/ios-dd" DEVELOPMENT_TEAM=$TEAM \
    -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic build > "$WORK/xcodebuild.log" 2>&1 \
    || die "iOS Release build failed (see $WORK/xcodebuild.log)"
  IOS_APP=$(ls -d "$WORK"/ios-dd/Build/Products/Release-iphoneos/*.app | head -1)
  echo "  ✓ built $IOS_APP"
else
  step "7/7 iOS native: no iPhone connected — skipped (Expo Go and the web app still update)"
fi

# Prebuild rewrites android/ and ios/; they're generated (git-ignored) — make sure nothing tracked moved.
git diff --quiet -- . ':!app.json' || die "the builds changed tracked files:
$(git status --porcelain)"

if [ "$VERIFY_ONLY" = 1 ]; then
  echo; echo "✓ ALL CHECKS PASSED (verify only — nothing published). log: $LOG"
  exit 0
fi

# ═══════════════════════════════ publish ═══════════════════════════════
step "publish: commit + tag $TAG"
LAST=$(git describe --tags --abbrev=0 2>/dev/null || true)
if [ -z "$NOTES" ]; then
  NOTES="$WORK/notes.md"
  { echo "## 바뀐 점"; git log --format='- %s' ${LAST:+$LAST..}HEAD | grep -v '^- release:' ; echo
    echo "## 설치"; echo "- 안드로이드: 아래 VoxelValley.apk (이전 버전 위에 그대로 덮어 설치)"
    echo "- 아이폰·PC: $PAGES/play/ (아이폰은 Safari → 공유 → 홈 화면에 추가)"; } > "$NOTES"
fi
[ -n "$TITLE" ] || TITLE="Voxel Valley ${VERSION%.*} — $(git log -1 --format=%s ${LAST:+$LAST..}HEAD | sed 's/^[a-z]*: //')"
git add app.json
git -c user.name=damho0514 -c user.email=damho0514@users.noreply.github.com commit -q -m "release: $TAG"
BUMPED=0
git tag "$TAG"
git push -q origin main "$TAG" || die "push failed (someone pushed meanwhile?) — nothing else was published; local commit+tag $TAG remain"

step "publish: web → $PAGES/play/"
rm -rf "$WORK/ghp"
git clone -q --depth 1 --branch gh-pages "https://x-access-token:$GH_TOKEN@github.com/$REPO.git" "$WORK/ghp"
rm -rf "$WORK/ghp/play" && cp -R "$WORK/web" "$WORK/ghp/play"
touch "$WORK/ghp/.nojekyll"
APKSIZE=$(python3 -c "import os;print(round(os.path.getsize('$WORK/VoxelValley.apk')/1e6))")
python3 - "$WORK/ghp/app/release.json" "$VERSION" "$APKSIZE" <<'PY'
import json,sys,os
p,v,size=sys.argv[1:]
if os.path.exists(p):
    d=json.load(open(p)); d['version']=v; d['apkInfo']=f'APK {size}MB · v{v} · 안드로이드 7.0 이상'
    json.dump(d,open(p,'w'),ensure_ascii=False,indent=1)
PY
(cd "$WORK/ghp" && git add -A && git -c user.name=damho0514 -c user.email=damho0514@users.noreply.github.com commit -q -m "Web $TAG" && git push -q origin gh-pages) \
  || die "gh-pages push failed (main is already tagged $TAG; re-run the publish steps)"
for _ in $(seq 1 40); do curl -s "$PAGES/play/?v=$RANDOM" | grep -q "$BUNDLE" && break; sleep 10; done
curl -s "$PAGES/play/?v=$RANDOM" | grep -q "$BUNDLE" || die "Pages never served the new bundle $BUNDLE"
node "$HERE/smoke.mjs" prod "$PAGES/play/" "$WORK/shots-live" || die "LIVE web smoke failed — check $PAGES/play/ now"

step "publish: Android release $TAG"
gh release create "$TAG" "$WORK/VoxelValley.apk" -R "$REPO" --target main --title "$TITLE" --notes-file "$NOTES" >/dev/null \
  || die "GitHub release failed"
DL=$(curl -sL -o /dev/null -w '%{http_code} %{size_download}' "https://github.com/$REPO/releases/download/$TAG/VoxelValley.apk")
echo "  APK download: $DL"

step "publish: iOS Expo Go update (channel production)"
(cd "$EAS_DIR" && git add -A && git -c user.name=damho0514 -c user.email=damho0514@users.noreply.github.com commit -q -m "sync $TAG" || true)
(cd "$EAS_DIR" && npx eas-cli@latest update --channel production --environment production --non-interactive --message "$TAG" > "$WORK/eas-update.log" 2>&1) \
  || die "eas update failed (see $WORK/eas-update.log) — web and Android are already out"
grep -iE "published|update group|Branch" "$WORK/eas-update.log" | head -4

if [ -n "$DEVICE_UDID" ]; then
  step "publish: install on the connected iPhone"
  if xcrun devicectl device install app --device "$DEVICE_UDID" "$IOS_APP" > "$WORK/ios-install.log" 2>&1; then
    xcrun devicectl device process launch --device "$DEVICE_UDID" "$PKG" >/dev/null 2>&1 || true
    echo "  ✓ installed on the iPhone (free signing: re-run within 7 days to keep it opening)"
  else
    echo "  ! iPhone install failed (locked phone?) — see $WORK/ios-install.log. Everything else is out."
  fi
fi

echo
echo "✓ RELEASED $TAG"
echo "  web      $PAGES/play/   (bundle $BUNDLE)"
echo "  android  https://github.com/$REPO/releases/tag/$TAG"
echo "  iOS      Expo Go channel production$([ -n "$DEVICE_UDID" ] && echo ' + connected iPhone')"
echo "  log      $LOG"
