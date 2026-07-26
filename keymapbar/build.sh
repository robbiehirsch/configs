#!/usr/bin/env bash
# Build KeymapBar.app — needs only the Xcode Command Line Tools you already
# have from Homebrew. Rebuild with ./build.sh; content changes never need a
# rebuild (press the app's ↻ instead).
set -euo pipefail
cd "$(dirname "$0")"

APP=KeymapBar.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.rh.keymapbar</string>
  <key>CFBundleName</key><string>KeymapBar</string>
  <key>CFBundleExecutable</key><string>KeymapBar</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

swiftc -O Sources/main.swift \
  -o "$APP/Contents/MacOS/KeymapBar" \
  -framework Cocoa -framework WebKit

codesign --force --sign - "$APP"
echo "✓ built $APP"
echo "  run:            open $APP"
echo "  login item:     System Settings → General → Login Items → + → $PWD/$APP"
