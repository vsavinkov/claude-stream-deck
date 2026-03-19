#!/usr/bin/env bash
# Status line script for Claude Code → Stream Deck bridge.
# Reads JSON from stdin, writes session file for bridge's fs.watch to pick up.

set -euo pipefail

SESSIONS_DIR="$HOME/.claude/streamdeck/sessions"
mkdir -p "$SESSIONS_DIR"

# Capture tty from the parent shell's stderr (fd 2), which is still connected to the terminal
TTY_PATH=""
if [ -t 2 ]; then
  TTY_PATH=$(tty <&2 2>/dev/null || true)
fi
# Fallback: walk up process tree to find the tty
if [ -z "$TTY_PATH" ] || [ "$TTY_PATH" = "not a tty" ]; then
  TTY_PATH=$(ps -o tty= -p $PPID 2>/dev/null | tr -d ' ' | sed 's/^/\/dev\//' || true)
fi

# Read full JSON from stdin
INPUT=$(cat)

# Extract session_id and inject tty
RESULT=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
sid = d.get('session_id', '')
if not sid:
    sys.exit(1)
d['tty'] = '''${TTY_PATH}'''
print(json.dumps(d))
" 2>/dev/null)

SESSION_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Atomic write: write to temp then rename
TMPFILE="$SESSIONS_DIR/.tmp.$$"
echo "$RESULT" > "$TMPFILE"
mv "$TMPFILE" "$SESSIONS_DIR/${SESSION_ID}.json"
