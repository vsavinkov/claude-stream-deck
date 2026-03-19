// Shared types for bridge server

export type AgentStatus = "waiting" | "working" | "finished" | "stopped";

export interface SessionState {
  sessionId: string;
  name: string;
  status: AgentStatus;
  contextPct: number;
  contextWindowSize: number;
  tokensUsed: number;
  tokensPct: number;
  costUsd: number;
  model: string;
  cwd: string;
  tty: string;
  lastUpdated: number; // epoch ms
}

export interface BridgeState {
  sessions: Record<string, SessionState>;
  totalCostUsd: number;
  totalTokens: number;
}

export interface HookPayload {
  session_id: string;
  cwd?: string;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  waiting: "#22c55e",  // green (same as finished)
  working: "#eab308",  // yellow
  finished: "#22c55e", // green
  stopped: "#ef4444",  // red
};

export const SESSIONS_DIR =
  process.env.HOME + "/.claude/streamdeck/sessions";
export const CONFIG_PATH =
  process.env.HOME + "/.claude/streamdeck/config.json";
export const BRIDGE_PORT = 9120;
export const HEARTBEAT_TIMEOUT_MS = Infinity; // sessions persist until explicitly ended or process dies
