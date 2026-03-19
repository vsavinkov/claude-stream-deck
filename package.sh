#!/usr/bin/env bash
set -euo pipefail

# Package the Stream Deck plugin as a .streamDeckPlugin file for distribution.
# The .streamDeckPlugin format is just a ZIP with a different extension.

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$REPO_DIR/plugin"
SDPLUGIN_DIR="$PLUGIN_DIR/com.vsavinkov.claude.sdPlugin"
OUTPUT="$REPO_DIR/com.vsavinkov.claude.streamDeckPlugin"

echo "=== Packaging Stream Deck Plugin ==="

# --- Build everything ---
echo "[1/4] Building bridge..."
(cd "$REPO_DIR/bridge" && npm install --silent && npm run build)

echo "[2/4] Building plugin..."
(cd "$PLUGIN_DIR" && npm install --silent && npm run build)

# --- Verify required files ---
echo "[3/4] Verifying build artifacts..."
for f in \
  "$SDPLUGIN_DIR/manifest.json" \
  "$SDPLUGIN_DIR/bin/plugin.js" \
  "$SDPLUGIN_DIR/imgs/plugin-icon.png" \
  "$SDPLUGIN_DIR/imgs/action-icon.png"
do
  if [ ! -f "$f" ]; then
    echo "ERROR: Missing required file: $f"
    exit 1
  fi
done

# --- Create .streamDeckPlugin (zip) ---
echo "[4/4] Creating $OUTPUT..."
rm -f "$OUTPUT"

cd "$PLUGIN_DIR"
# Include only the sdPlugin directory contents, excluding dev artifacts
zip -r "$OUTPUT" "com.vsavinkov.claude.sdPlugin" \
  -x "com.vsavinkov.claude.sdPlugin/logs/*" \
  -x "com.vsavinkov.claude.sdPlugin/bin/*.map" \
  > /dev/null

echo ""
echo "=== Done ==="
echo "Output: $OUTPUT"
echo "Size:   $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "To install: double-click the .streamDeckPlugin file"
echo "Note: Users still need to run install.sh for the bridge server and Claude Code hooks."
