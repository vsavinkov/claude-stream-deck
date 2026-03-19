# Stream Deck + Integration for Claude Code

## Overview

A Stream Deck + plugin that displays real-time status of up to 8 Claude Code sessions running in iTerm2 tabs. Push-based architecture — no polling.

## Hardware: Elgato Stream Deck +

- **8 LCD keys**: 2 rows x 4, 144x144px each. Rendered via SVG string templates passed to `setImage()`.
- **4 rotary encoders**: 360-degree, with push. Events: `onDialRotate`, `onDialDown`/`onDialUp`.
- **Touch strip LCD**: 800x100px total, 4 segments of 200x100px each. Rendered via structured layouts (`setFeedback()` delta updates, NOT images).
- SDK: `@elgato/streamdeck` (Node.js/TypeScript), CLI: `@elgato/cli`
- Manifest `SDKVersion`: 2, min Stream Deck software: 6.4+
- Plugin communicates with Stream Deck app over WebSocket (managed by SDK)

## Layout

### Keys (2 rows x 4)

Each active session occupies one key. Inactive slots are dim/empty.

```
 ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
 │ ╔══violet════╗ │ │ ╔══yellow════╗ │ │ ╔══green═════╗ │ │ ╔═══red══════╗ │
 │ ║    aaif    ║ │ │ ║   deploy   ║ │ │ ║    build   ║ │ │ ║    fix     ║ │
 │ ║ctx ▓▓▓░ 72%║ │ │ ║ctx ▓▓░░ 45%║ │ │ ║ctx ▓▓▓▓ 91%║ │ │ ║ctx ▓░░░ 23%║ │
 │ ║tkn ▓░░░ 23k║ │ │ ║tkn ▓▓░░105k║ │ │ ║tkn ▓░░░  3k║ │ │ ║tkn ▓░░░  1k║ │
 │ ╚════════════╝ │ │ ╚════════════╝ │ │ ╚════════════╝ │ │ ╚════════════╝ │
 └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘
 ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
 │   (empty)      │ │   (empty)      │ │   (empty)      │ │   (empty)      │
 └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘
```

**Button SVG contains:**
- Colored border: violet (waiting for input), yellow (working), green (finished), red (stopped/failed)
- Emoji + session name (derived from `cwd` basename)
- Context remaining: thin progress bar + percentage text
- Session tokens used: thin progress bar + human-readable count (1k, 23k, 105k)

**Button interaction:** Tap = focus the iTerm2 tab for that session (via AppleScript).

### Touch Strip (4 segments)

```
 ┌────────────────────┬────────────────────┬────────────────────┬────────────────────┐
 │     New Session    │   Daily Tokens     │   Weekly Tokens    │  Active / Total    │
 │   ◆ sonnet ◆       │  ▓▓▓▓▓▓░░░░ 62%    │  ▓▓▓▓░░░░░░ 41%    │   3 active / 4     │
 └────────────────────┴────────────────────┴────────────────────┴────────────────────┘
```

| Segment | Layout | Content |
|---------|--------|---------|
| 1 | Custom text | Selected model name (haiku/sonnet/opus) |
| 2 | `$B1` indicator | Daily token budget remaining % |
| 3 | `$B1` indicator | Weekly token budget remaining % |
| 4 | Custom text | Active session count / total |

**Touch strip uses `setFeedback()` delta updates** — only changed properties are sent. No image rendering.

### Dials

| Dial | Rotate | Push |
|------|--------|------|
| 1 | Cycle model: haiku → sonnet → opus | Create new iTerm2 tab + run `claude --model <selected>` |
| 2 | (free) | (free) |
| 3 | (free) | (free) |
| 4 | (free) | (free) |

## Architecture

```
Claude Code Sessions (1..8)
  ├─ Status line script ──→ writes JSON to ~/.claude/streamdeck/<session_id>.json
  └─ Hooks (HTTP POST) ──→ Bridge server event endpoint

Bridge Server (localhost:9120, Node.js)
  ├─ fs.watch() on ~/.claude/streamdeck/ ──→ detects session state changes
  ├─ fs.watch() on ~/.claude/projects/**/*.jsonl ──→ daily/weekly token aggregation
  ├─ HTTP endpoint for hook events
  └─ WebSocket server ──→ pushes state to Stream Deck plugin

Stream Deck Plugin (Node.js, @elgato/streamdeck SDK)
  ├─ WebSocket client ──→ connects to bridge
  ├─ Renders SVG button templates on state change
  ├─ Updates touch strip via setFeedback()
  └─ AppleScript (osascript) for iTerm2 tab switching / new tab creation
```

### Why a bridge server?

The Stream Deck plugin runs inside the Stream Deck app's Node.js sandbox. While it has full Node.js API access, separating the bridge keeps concerns clean: the bridge aggregates data from multiple Claude sessions, the plugin only handles rendering and interaction. The bridge can also serve a debug web UI later.

## Data Flow (All Push-Based)

### Per-Session Data (Status Line Script)

Claude Code's status line feature calls a user-defined script on every state change, passing JSON on stdin.

**Setup:** Configure in `~/.claude/settings.json`:
```json
{
  "statusLine": {
    "command": "~/.claude/streamdeck/status-line.sh"
  }
}
```

**The script receives JSON with:**
```json
{
  "context_window": {
    "used_percentage": 72,
    "remaining_percentage": 28,
    "context_window_size": 200000,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200
    }
  },
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/Users/daemonic/vsavinkov/aaif",
  "model": { "id": "claude-sonnet-4-6", "display_name": "Sonnet" }
}
```

**The script writes to:** `~/.claude/streamdeck/sessions/<session_id>.json`
**Bridge detects change via:** `fs.watch()`

### Agent Status (Hooks)

Configure in `~/.claude/settings.json`:
```json
{
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9120/hook/notification"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9120/hook/stop"
      }]
    }],
    "SessionEnd": [{
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9120/hook/session-end"
      }]
    }]
  }
}
```

**Status mapping:**
| Hook Event | Agent Status | Border Color |
|------------|-------------|--------------|
| Notification (needs input) | waiting | violet |
| Between hooks (tool running) | working | yellow |
| Stop (completed turn) | finished | green |
| SessionEnd / no heartbeat 30s | stopped | red |

### Daily/Weekly Token Budget

**Source:** JSONL files in `~/.claude/projects/` (same approach as [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor))

**Bridge server:**
- Watches JSONL files via `fs.watch()` for push-based updates
- Aggregates token counts per day/week
- Compares against plan limits from config

**Plan limits config** (`~/.claude/streamdeck/config.json`):
```json
{
  "plan": "max5",
  "limits": {
    "pro":   { "daily": 19000 },
    "max5":  { "daily": 88000 },
    "max20": { "daily": 220000 }
  }
}
```

### Session Name

Derived from `cwd` basename in the status line JSON. E.g.:
- `/Users/daemonic/vsavinkov/aaif` → `aaif`
- `/Users/daemonic/vsavinkov/llm-api` → `llm-api`

No polling. Pushed with every status line update.

## Button Rendering

Buttons are rendered as **SVG string templates**. No canvas, no image encoding. Just string interpolation:

```typescript
function renderButton(session: SessionState): string {
  const borderColor = STATUS_COLORS[session.status] // violet/yellow/green/red
  const ctxWidth = (session.contextPct / 100) * BAR_MAX_WIDTH
  const tknWidth = (session.tokensPct / 100) * BAR_MAX_WIDTH
  const tokensLabel = formatTokens(session.tokensUsed) // 1k, 23k, 105k

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
    <!-- border -->
    <rect x="2" y="2" width="140" height="140" rx="10"
          fill="#1a1a2e" stroke="${borderColor}" stroke-width="4"/>
    <!-- emoji + name -->
    <text x="72" y="32" text-anchor="middle" fill="white"
          font-size="16" font-weight="bold">${session.emoji} ${session.name}</text>
    <!-- context bar -->
    <text x="12" y="62" fill="#aaa" font-size="11">ctx</text>
    <rect x="38" y="52" width="${BAR_MAX_WIDTH}" height="10" rx="3" fill="#333"/>
    <rect x="38" y="52" width="${ctxWidth}" height="10" rx="3" fill="#7c3aed"/>
    <text x="132" y="62" text-anchor="end" fill="white" font-size="11">${session.contextPct}%</text>
    <!-- token bar -->
    <text x="12" y="88" fill="#aaa" font-size="11">tkn</text>
    <rect x="38" y="78" width="${BAR_MAX_WIDTH}" height="10" rx="3" fill="#333"/>
    <rect x="38" y="78" width="${tknWidth}" height="10" rx="3" fill="#2563eb"/>
    <text x="132" y="88" text-anchor="end" fill="white" font-size="11">${tokensLabel}</text>
  </svg>`
}
```

Cost: ~0.01ms to build the string. Stream Deck app rasterizes. Only regenerated when session state actually changes.

## iTerm2 Integration (AppleScript)

### Switch to tab (on key press)

```applescript
tell application "iTerm2"
  activate
  tell current window
    -- find tab by session name in title
    repeat with t in tabs
      repeat with s in sessions of t
        if name of s contains "TARGET_SESSION_NAME" then
          select t
          return
        end if
      end repeat
    end repeat
  end tell
end tell
```

### Create new session (on dial 1 push)

```applescript
tell application "iTerm2"
  activate
  tell current window
    create tab with default profile
    tell current session of current tab
      write text "claude --model MODEL_NAME"
    end tell
  end tell
end tell
```

## Project Structure

```
streamdeck-claude/
├── DESIGN.md                          # This file
├── bridge/                            # Bridge server
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── server.ts                  # HTTP + WebSocket server on :9120
│   │   ├── session-watcher.ts         # fs.watch on ~/.claude/streamdeck/sessions/
│   │   ├── token-aggregator.ts        # JSONL reader for daily/weekly totals
│   │   ├── state.ts                   # Centralized state management
│   │   └── types.ts                   # Shared types
│   └── scripts/
│       └── status-line.sh             # Status line script (writes session JSON)
├── plugin/                            # Stream Deck plugin
│   ├── package.json
│   ├── tsconfig.json
│   ├── rollup.config.mjs
│   ├── com.vsavinkov.claude.sdPlugin/
│   │   ├── manifest.json
│   │   ├── imgs/                      # Plugin icons
│   │   ├── layouts/                   # Custom touch strip layouts
│   │   │   ├── model-selector.json    # Segment 1: model name display
│   │   │   └── session-count.json     # Segment 4: active/total
│   │   └── ui/                        # Property Inspector HTML
│   └── src/
│       ├── plugin.ts                  # Entry point, WebSocket to bridge
│       ├── actions/
│       │   ├── agent-key.ts           # Key action: render agent button, handle tap
│       │   └── model-dial.ts          # Encoder action: model selector + new session
│       ├── renderers/
│       │   └── button-svg.ts          # SVG template for agent buttons
│       └── iterm.ts                   # AppleScript helpers for iTerm2
└── config/
    └── claude-settings-snippet.json   # Hook + status line config to merge into ~/.claude/settings.json
```

## Implementation Order

1. **Bridge server** — HTTP endpoint for hooks, fs.watch for session files, WebSocket server
2. **Status line script** — Parse stdin JSON, write session file
3. **Hook config** — Configure Claude Code hooks to POST to bridge
4. **Stream Deck plugin scaffold** — `@elgato/cli create`, manifest, action stubs
5. **Button rendering** — SVG templates, WebSocket client consuming bridge state
6. **Touch strip** — Custom layouts for model selector, `$B1` for token budgets
7. **Dial 1** — Model cycling + new session creation
8. **iTerm2 integration** — Tab switching on key tap, new tab on dial push
9. **Token aggregation** — JSONL reader for daily/weekly budget tracking
10. **Cleanup sweep** — 30s heartbeat to detect dead sessions

## Key Dependencies

- `@elgato/streamdeck` — Stream Deck SDK
- `@elgato/cli` — Plugin scaffolding and packaging
- `ws` — WebSocket server (bridge side)
- `chokidar` — Robust file watching (better than raw `fs.watch` for macOS)
- Node.js 20+
- iTerm2 (with AppleScript enabled)

## Edge Cases

- **Session dies without SessionEnd hook**: 30s cleanup sweep checks if session file's mtime is stale
- **More than 8 sessions**: Only show 8 most recent; dial 2 could page through if needed later
- **iTerm2 not running**: Graceful no-op on AppleScript calls
- **Bridge server not running**: Plugin shows "disconnected" state on all buttons
- **Status line script errors**: Write to stderr for debug, never block Claude Code
