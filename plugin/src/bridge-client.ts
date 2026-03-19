import streamDeck from "@elgato/streamdeck";
import WebSocket from "ws";

const BRIDGE_URL = "ws://127.0.0.1:9120";
const RECONNECT_INTERVAL = 3000;

// --- Bridge state types (mirrors bridge/src/types.ts) ---
export interface SessionState {
  sessionId: string;
  name: string;
  status: string;
  contextPct: number;
  contextWindowSize: number;
  tokensUsed: number;
  tokensPct: number;
  costUsd: number;
  model: string;
  cwd: string;
  tty: string;
  lastUpdated: number;
}

export interface BridgeState {
  sessions: Record<string, SessionState>;
  totalCostUsd: number;
  totalTokens: number;
}

class BridgeClient {
  private ws: WebSocket | null = null;
  private state: BridgeState | null = null;
  private sessionSlots: string[] = [];
  private listeners: Array<() => void> = [];

  connect(): void {
    try {
      this.ws = new WebSocket(BRIDGE_URL);

      this.ws.on("open", () => {
        streamDeck.logger.info("Connected to bridge");
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        try {
          this.state = JSON.parse(data.toString());
          this.updateSlots();
          this.notifyListeners();
        } catch (e) {
          streamDeck.logger.error(`Bridge message parse error: ${e}`);
        }
      });

      this.ws.on("close", () => {
        streamDeck.logger.warn("Bridge connection closed, reconnecting...");
        this.state = null;
        setTimeout(() => this.connect(), RECONNECT_INTERVAL);
      });

      this.ws.on("error", () => {
        // Will trigger close event
      });
    } catch {
      setTimeout(() => this.connect(), RECONNECT_INTERVAL);
    }
  }

  getState(): BridgeState | null {
    return this.state;
  }

  getSessionBySlot(index: number): SessionState | null {
    if (!this.state) return null;
    const sessionId = this.sessionSlots[index];
    return sessionId ? this.state.sessions[sessionId] ?? null : null;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  // Slot reserved for the next new session (set when pressing an empty key)
  private reservedSlot: number = -1;

  private updateSlots(): void {
    if (!this.state) return;

    // Clear slots whose sessions no longer exist
    for (let i = 0; i < this.sessionSlots.length; i++) {
      if (this.sessionSlots[i] && !(this.sessionSlots[i] in this.state.sessions)) {
        this.sessionSlots[i] = "";
      }
    }

    // Assign new sessions
    const assigned = new Set(this.sessionSlots.filter(Boolean));
    for (const id of Object.keys(this.state.sessions)) {
      if (!assigned.has(id)) {
        // If a slot was reserved for the next new session, use it
        if (this.reservedSlot >= 0 && !this.sessionSlots[this.reservedSlot]) {
          this.sessionSlots[this.reservedSlot] = id;
          assigned.add(id);
          this.reservedSlot = -1;
          continue;
        }
        this.reservedSlot = -1;

        // Otherwise find first empty slot
        let placed = false;
        for (let i = 0; i < 8; i++) {
          if (!this.sessionSlots[i]) {
            this.sessionSlots[i] = id;
            assigned.add(id);
            placed = true;
            break;
          }
        }
        if (!placed) break;
      }
    }
  }

  /** Reserve a specific slot for the next new session */
  reserveSlot(index: number): void {
    // Ensure the array is long enough
    while (this.sessionSlots.length <= index) {
      this.sessionSlots.push("");
    }
    this.reservedSlot = index;
  }

  private notifyListeners(): void {
    for (const fn of this.listeners) fn();
  }
}

export const bridgeClient = new BridgeClient();
