#!/bin/zsh
# Builds "MasterPrac.app" in /Applications: a normal app (Dock icon, one window, quits when closed).
# Re-run after moving this folder or changing the launcher. Code/page changes need no rebuild.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/MasterPrac.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT/assets/icon.icns" "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MasterPrac</string>
  <key>CFBundleDisplayName</key><string>MasterPrac</string>
  <key>CFBundleIdentifier</key><string>com.local.masterprac</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MasterPrac</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSBluetoothAlwaysUsageDescription</key><string>MasterPrac moves your Mac's sound to your HeadRush amp while you practise, and back to your speakers when you close it.</string>
  <key>NSAppleEventsUsageDescription</key><string>MasterPrac mutes Spotify while you practise (it keeps playing so your minutes count) and turns it back up when you close it.</string>
  <key>NSAudioCaptureUsageDescription</key><string>MasterPrac listens to the music your Mac plays to work out its chords ("Chords by ear"). Nothing is recorded or saved.</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

PYHOME="$("$ROOT/.venv/bin/python" -c 'import sys; print(sys.base_prefix)')"
SITE="$("$ROOT/.venv/bin/python" -c 'import site; print(site.getsitepackages()[0])')"
clang -O2 -DPYTHON_HOME="\"$PYHOME\"" -DAPP_ROOT="\"$ROOT\"" -DSITE_DIR="\"$SITE\"" \
  "$ROOT/launcher/masterprac.c" -o "$APP/Contents/MacOS/MasterPrac"

# its own ears: hears the Mac's sound (audio only) for "Chords by ear"
swiftc -O "$ROOT/tools/audiotap.swift" -o "$APP/Contents/MacOS/audiotap"

# sign with the same self-made certificate as Custamo, so macOS remembers MasterPrac's permissions across rebuilds
IDENTITY="-"
CERT=$(security find-identity -p codesigning | awk '/"Custamo Local Signing"/ {print $2; exit}')
[ -n "$CERT" ] && IDENTITY="$CERT"
echo "  signing with: $IDENTITY"
codesign --force --deep --sign "$IDENTITY" --identifier com.local.masterprac "$APP"
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "Built: $APP"
