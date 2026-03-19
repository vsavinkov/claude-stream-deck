import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { BridgeState, SessionState, SESSIONS_DIR } from "./types.js";

let state: BridgeState = {
  sessions: {},
  totalCostUsd: 0,
  totalTokens: 0,
};

let initialized = false;
const listeners: Array<(s: BridgeState) => void> = [];

export function getState(): BridgeState {
  return state;
}

/** Mark initial load complete — after this, file updates mean "working" */
export function markInitialized(): void {
  initialized = true;
}

export function updateSession(session: SessionState): void {
  if (!initialized) {
    session.status = "finished";
  } else {
    const existing = state.sessions[session.sessionId];
    if (existing) {
      // Only transition to "working" if data actually changed (tokens/cost increased).
      // This prevents status-line file rewrites from overriding hook-set statuses
      // (waiting/finished/stopped) when Claude is idle.
      const dataChanged = session.tokensUsed !== existing.tokensUsed
        || session.costUsd !== existing.costUsd
        || session.contextPct !== existing.contextPct;
      // Don't override hook-set status during grace period
      const hookTime = hookStatusTime.get(session.sessionId) ?? 0;
      const hookProtected = (Date.now() - hookTime) < HOOK_GRACE_MS;
      if (hookProtected || !dataChanged) {
        session.status = existing.status;
      }
      // Preserve lastUpdated if no data changed — prevents idle timeout from oscillating
      if (!dataChanged) {
        session.lastUpdated = existing.lastUpdated;
      }
    }
    // else: new session → "working" is correct
  }
  state.sessions[session.sessionId] = session;
  recomputeTotals();
  notify();
}

// Track when hooks set status — file updates won't override for a grace period
const hookStatusTime = new Map<string, number>();
const HOOK_GRACE_MS = 5_000;

export function setSessionStatus(sessionId: string, status: SessionState["status"]): void {
  const s = state.sessions[sessionId];
  if (s) {
    s.status = status;
    s.lastUpdated = Date.now();
    hookStatusTime.set(sessionId, Date.now());
    notify();
  }
}

export function removeSession(sessionId: string): void {
  delete state.sessions[sessionId];
  recomputeTotals();
  notify();
}

export function onStateChange(fn: (s: BridgeState) => void): void {
  listeners.push(fn);
}

function recomputeTotals(): void {
  let cost = 0;
  let tokens = 0;
  for (const s of Object.values(state.sessions)) {
    cost += s.costUsd;
    tokens += s.tokensUsed;
  }
  state.totalCostUsd = cost;
  state.totalTokens = tokens;
}

function notify(): void {
  for (const fn of listeners) {
    fn(state);
  }
}

/**
 * Fetch all TTYs currently visible in iTerm2 (one AppleScript call per sweep).
 * Returns null if iTerm isn't running or the call fails.
 */
function getItermTTYs(): Set<string> | null {
  try {
    const script = `
      tell application "iTerm2"
        set ttys to {}
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              copy (tty of s) to end of ttys
            end repeat
          end repeat
        end repeat
        set AppleScript's text item delimiters to ","
        return ttys as text
      end tell`;
    const out = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    // AppleScript returns comma-separated list like "/dev/ttys001, /dev/ttys005"
    return new Set(out.split(",").map((s) => s.trim()).filter(Boolean));
  } catch {
    return null;
  }
}

/** Check if a Claude process is still running for this session */
function isSessionAlive(session: SessionState, itermTTYs: Set<string> | null): boolean {
  // TTY gone = terminal closed
  if (session.tty && !existsSync(session.tty)) return false;

  // No TTY info — can't verify, rely on heartbeat timeout
  if (!session.tty) return true;

  // If we have iTerm data, check if the TTY is still visible.
  // Catches Cmd+W during iTerm's undo grace period (tab gone from UI
  // but process still alive for ~5s).
  if (itermTTYs !== null && !itermTTYs.has(session.tty)) return false;

  // Fallback: check if a claude process is attached to this TTY
  try {
    const ttyShort = session.tty.replace("/dev/", "");
    const out = execSync(
      `ps -t ${ttyShort} -o pid,comm= 2>/dev/null`,
      { encoding: "utf-8", timeout: 3000 },
    );
    return out.split("\n").some((line) => /\bclaude\b/.test(line));
  } catch {
    return false;
  }
}

/** If a session has been "working" for a while with no data changes, assume idle */
const IDLE_TIMEOUT_MS = 10_000;

/** Remove dead sessions (no Claude process) and mark timed-out ones as stopped */
export function cleanupStaleSessions(): void {
  const now = Date.now();
  let changed = false;

  if (Object.keys(state.sessions).length === 0) return;

  // Single AppleScript call to get all visible iTerm TTYs
  const itermTTYs = getItermTTYs();

  // When multiple sessions share the same TTY, only the most recently updated
  // one can be alive (only one claude runs per terminal at a time).
  // Build a map: tty → newest sessionId
  const newestByTty = new Map<string, string>();
  for (const [id, session] of Object.entries(state.sessions)) {
    if (!session.tty) continue;
    const existing = newestByTty.get(session.tty);
    if (!existing || session.lastUpdated > (state.sessions[existing]?.lastUpdated ?? 0)) {
      newestByTty.set(session.tty, id);
    }
  }

  for (const [id, session] of Object.entries(state.sessions)) {
    const age = now - session.lastUpdated;

    // Don't kill fresh sessions (process may not be fully started yet)
    // BUT do check iTerm — if the tab is gone, it's definitely dead
    if (age < 60_000 && (itermTTYs === null || itermTTYs.has(session.tty))) continue;

    // If another session on the same TTY is newer, this one is stale
    const isNewestOnTty = !session.tty || newestByTty.get(session.tty) === id;

    if (!isNewestOnTty || !isSessionAlive(session, itermTTYs)) {
      console.log(`[cleanup] removing dead session ${id} (${isNewestOnTty ? "no claude process" : "superseded by newer session on same TTY"})`);
      delete state.sessions[id];
      try { unlinkSync(join(SESSIONS_DIR, `${id}.json`)); } catch {}
      changed = true;
    }
  }

  // Idle detection: transition to "waiting" when Claude isn't actively working.
  // "working" → "waiting" after IDLE_TIMEOUT_MS (fallback when hooks don't fire)
  // "finished" → "waiting" after 5s (green flash then settle to violet)
  for (const session of Object.values(state.sessions)) {
    const age = now - session.lastUpdated;
    if (session.status === "working" && age > IDLE_TIMEOUT_MS) {
      session.status = "waiting";
      changed = true;
    } else if (session.status === "finished" && age > 5_000) {
      session.status = "waiting";
      changed = true;
    }
  }
  if (changed) {
    recomputeTotals();
    notify();
  }
}
