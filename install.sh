#!/usr/bin/env bash
set -euo pipefail

# --- Configuration ---
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$REPO_DIR/bridge"
PLUGIN_DIR="$REPO_DIR/plugin"
SDPLUGIN_DIR="$PLUGIN_DIR/com.vsavinkov.claude.sdPlugin"
SETTINGS_SNIPPET="$REPO_DIR/config/claude-settings-snippet.json"

STREAMDECK_PLUGINS_DIR="$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CLAUDE_STREAMDECK_DIR="$HOME/.claude/streamdeck"
LAUNCHD_LABEL="com.vsavinkov.claude-bridge"
PLIST_PATH="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
NODE_BIN="$(which node 2>/dev/null || true)"

# --- Uninstall mode ---
if [ "${1:-}" = "--uninstall" ]; then
  echo "=== Uninstalling Stream Deck Claude Code Monitor ==="

  echo "[1/4] Stopping bridge daemon..."
  launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null || true
  rm -f "$PLIST_PATH"

  echo "[2/4] Removing plugin symlink..."
  LINK_TARGET="$STREAMDECK_PLUGINS_DIR/com.vsavinkov.claude.sdPlugin"
  if [ -L "$LINK_TARGET" ]; then
    rm "$LINK_TARGET"
  elif [ -d "$LINK_TARGET" ]; then
    echo "       WARNING: $LINK_TARGET is not a symlink, skipping."
  fi

  echo "[3/4] Cleaning up ~/.claude/streamdeck/..."
  rm -f "$CLAUDE_STREAMDECK_DIR/status-line.sh"
  rm -f "$CLAUDE_STREAMDECK_DIR/bridge.log"
  rm -f "$CLAUDE_STREAMDECK_DIR/bridge.err.log"
  rm -rf "$CLAUDE_STREAMDECK_DIR/sessions"
  rmdir "$CLAUDE_STREAMDECK_DIR" 2>/dev/null || true

  echo "[4/4] Removing hooks from Claude settings..."
  if [ -f "$CLAUDE_SETTINGS" ]; then
    cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
    python3 << 'PYEOF'
import json, os

settings_path = os.path.expanduser("~/.claude/settings.json")
with open(settings_path) as f:
    settings = json.load(f)

# Remove statusLine if it points to our script
sl = settings.get("statusLine", {})
if isinstance(sl, dict) and "streamdeck" in sl.get("command", ""):
    del settings["statusLine"]

# Remove hook entries that point to localhost:9120
if "hooks" in settings:
    for hook_type in list(settings["hooks"].keys()):
        entries = settings["hooks"][hook_type]
        filtered = []
        for entry in entries:
            hooks = entry.get("hooks", [])
            hooks = [h for h in hooks if "localhost:9120" not in h.get("url", "")]
            if hooks:
                entry["hooks"] = hooks
                filtered.append(entry)
        if filtered:
            settings["hooks"][hook_type] = filtered
        else:
            del settings["hooks"][hook_type]
    if not settings["hooks"]:
        del settings["hooks"]

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
print("       Settings cleaned.")
PYEOF
  fi

  echo ""
  echo "=== Uninstall complete ==="
  echo "Note: node_modules and build artifacts left in place."
  echo "      To fully clean: rm -rf $BRIDGE_DIR/node_modules $BRIDGE_DIR/dist $PLUGIN_DIR/node_modules"
  exit 0
fi

# --- Preflight checks ---
echo "=== Stream Deck Claude Code Monitor — Installer ==="
echo ""

if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found in PATH. Install Node.js 20+ first."
  echo "       brew install node"
  exit 1
fi

NODE_VERSION=$("$NODE_BIN" --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "ERROR: Node.js 20+ required, found $("$NODE_BIN" --version)"
  exit 1
fi

if [ ! -d "$STREAMDECK_PLUGINS_DIR" ]; then
  echo "ERROR: Stream Deck plugins directory not found."
  echo "       Is the Elgato Stream Deck app installed?"
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: Claude Code CLI not found."
  echo "       Install: npm install -g @anthropic-ai/claude-code"
  exit 1
fi

echo "Node.js: $("$NODE_BIN" --version) at $NODE_BIN"
echo "Claude:  $(claude --version 2>/dev/null || echo 'unknown')"
echo "Repo:    $REPO_DIR"
echo ""

# --- Step 1: Install dependencies ---
echo "[1/6] Installing dependencies..."
(cd "$BRIDGE_DIR" && npm install)
(cd "$PLUGIN_DIR" && npm install)

# --- Step 2: Build ---
echo "[2/6] Building bridge..."
(cd "$BRIDGE_DIR" && npm run build)

echo "       Building plugin..."
(cd "$PLUGIN_DIR" && npm run build)

# --- Step 3: Symlink plugin ---
echo "[3/6] Symlinking plugin to Stream Deck..."
LINK_TARGET="$STREAMDECK_PLUGINS_DIR/com.vsavinkov.claude.sdPlugin"
if [ -L "$LINK_TARGET" ]; then
  rm "$LINK_TARGET"
elif [ -d "$LINK_TARGET" ]; then
  echo "       WARNING: Directory exists at target (not a symlink)."
  echo "       Backing up to ${LINK_TARGET}.bak"
  mv "$LINK_TARGET" "${LINK_TARGET}.bak"
fi
ln -s "$SDPLUGIN_DIR" "$LINK_TARGET"
echo "       Linked plugin."

# --- Step 4: Install status-line script ---
echo "[4/6] Installing status-line script..."
mkdir -p "$CLAUDE_STREAMDECK_DIR/sessions"
cp "$BRIDGE_DIR/scripts/status-line.sh" "$CLAUDE_STREAMDECK_DIR/status-line.sh"
chmod +x "$CLAUDE_STREAMDECK_DIR/status-line.sh"

# --- Step 5: Configure Claude Code settings ---
echo "[5/6] Merging Claude Code settings..."
if [ ! -f "$CLAUDE_SETTINGS" ]; then
  mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
  echo '{}' > "$CLAUDE_SETTINGS"
fi

cp "$CLAUDE_SETTINGS" "${CLAUDE_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"

SNIPPET_PATH="$SETTINGS_SNIPPET" python3 << 'PYEOF'
import json, os

settings_path = os.path.expanduser("~/.claude/settings.json")
snippet_path = os.environ["SNIPPET_PATH"]

with open(settings_path) as f:
    settings = json.load(f)
with open(snippet_path) as f:
    snippet = json.load(f)

# Set statusLine
if "statusLine" in snippet:
    settings["statusLine"] = snippet["statusLine"]

# Merge hooks (append entries whose URL isn't already present)
if "hooks" in snippet:
    if "hooks" not in settings:
        settings["hooks"] = {}
    for hook_type, hook_entries in snippet["hooks"].items():
        if hook_type not in settings["hooks"]:
            settings["hooks"][hook_type] = []
        existing_urls = set()
        for entry in settings["hooks"][hook_type]:
            for h in entry.get("hooks", []):
                if "url" in h:
                    existing_urls.add(h["url"])
        for entry in hook_entries:
            entry_urls = {h["url"] for h in entry.get("hooks", []) if "url" in h}
            if not entry_urls & existing_urls:
                settings["hooks"][hook_type].append(entry)

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
print("       Settings merged.")
PYEOF

# --- Step 6: Create and load launchd daemon ---
echo "[6/6] Setting up bridge daemon..."

launchctl bootout "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null || true

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${BRIDGE_DIR}/dist/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${BRIDGE_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${CLAUDE_STREAMDECK_DIR}/bridge.log</string>
  <key>StandardErrorPath</key>
  <string>${CLAUDE_STREAMDECK_DIR}/bridge.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>$(dirname "$NODE_BIN"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLISTEOF

launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
echo "       Bridge daemon started."

# --- Done ---
echo ""
echo "=== Installation complete! ==="
echo ""
echo "Next steps:"
echo "  1. Restart the Stream Deck app"
echo "  2. Drag 'Agent Key' actions onto keys (set Slot 1-8 in settings)"
echo "  3. Drag 'Model Dial', 'Effort Dial', 'Permission Dial' onto encoders"
echo "  4. Start a Claude Code session — it will appear on your deck!"
echo ""
echo "Key actions:"
echo "  Single click  → focus session in iTerm"
echo "  Double click  → compact session context"
echo "  Long press    → kill session"
echo "  Click empty   → create new session"
echo ""
echo "Logs:      ~/.claude/streamdeck/bridge.log"
echo "Uninstall: $REPO_DIR/install.sh --uninstall"
