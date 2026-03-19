import chokidar from "chokidar";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { basename } from "path";
import { exec } from "child_process";
import { SESSIONS_DIR, SessionState } from "./types.js";
import { getState, updateSession, markInitialized } from "./state.js";

// Cache: sessionId → derived name (so we only read transcript once)
const nameCache = new Map<string, string>();
// Sessions currently being summarized by AI (avoid duplicate requests)
const pendingSummaries = new Set<string>();

export function startSessionWatcher(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }

  const watcher = chokidar.watch(SESSIONS_DIR, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  });

  watcher.on("add", handleFile);
  watcher.on("change", handleFile);
  watcher.on("ready", () => {
    markInitialized();
    console.log("[session-watcher] initial scan complete");
  });

  console.log(`[session-watcher] watching ${SESSIONS_DIR}`);
}

function deriveSessionName(data: any): string {
  const sessionId = data.session_id;

  // Return cached name if we have one (only caches once a real user message is found)
  if (nameCache.has(sessionId)) return nameCache.get(sessionId)!;

  // Try to read the transcript and extract first user message
  const transcriptPath = data.transcript_path;
  if (transcriptPath && existsSync(transcriptPath)) {
    try {
      const content = readFileSync(transcriptPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.type === "user" && entry.message?.content) {
            const text = typeof entry.message.content === "string"
              ? entry.message.content
              : Array.isArray(entry.message.content)
                ? entry.message.content
                    .filter((b: any) => b.type === "text")
                    .map((b: any) => b.text)
                    .join(" ")
                : "";
            if (text) {
              // Use quick truncation immediately, kick off AI summary in background
              const quickName = truncatePrompt(text);
              nameCache.set(sessionId, quickName);
              aiSummarize(sessionId, text);
              return quickName;
            }
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* transcript not readable yet */ }
  }

  // No user message yet
  return "";
}

/** Quick fallback: truncate at word boundary */
function truncatePrompt(text: string): string {
  const clean = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= 30) return clean;
  const t = clean.slice(0, 30);
  const ls = t.lastIndexOf(" ");
  return (ls > 10 ? t.slice(0, ls) : t) + "…";
}

/** Use Claude haiku to generate a short button label (async, updates cache when done) */
function aiSummarize(sessionId: string, text: string): void {
  if (pendingSummaries.has(sessionId)) return;
  pendingSummaries.add(sessionId);

  const input = `Summarize this user request in 2-5 words as a short label for a button. Output ONLY the label, no quotes or punctuation at the end.\n\nRequest: ${text.slice(0, 500)}`;
  const env = { ...process.env, ANTHROPIC_API_KEY: "" };
  console.log(`[session-watcher] requesting AI summary for ${sessionId.slice(0, 8)}...`);

  const child = exec(
    `claude -p --model haiku --effort low`,
    { timeout: 15000, env },
    (err: Error | null, stdout: string, stderr: string) => {
      pendingSummaries.delete(sessionId);
      if (err) {
        console.error(`[session-watcher] AI summary failed: ${err.message} ${stderr}`);
        return;
      }
      if (stdout.trim()) {
        let label = stdout.trim().replace(/^["']|["']$/g, "").replace(/[.!]$/, "");
        if (label.length > 36) {
          const t = label.slice(0, 36);
          const ls = t.lastIndexOf(" ");
          label = ls > 15 ? t.slice(0, ls) : t;
        }
        nameCache.set(sessionId, label);
        console.log(`[session-watcher] AI name for ${sessionId.slice(0, 8)}: ${label}`);
      }
    },
  );
  child.stdin?.write(input);
  child.stdin?.end();
}

function handleFile(filePath: string): void {
  if (!filePath.endsWith(".json")) return;

  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);

    const usedPct = data.context_window?.used_percentage ?? 0;
    const windowSize = data.context_window?.context_window_size ?? 200000;

    // Context window tokens = percentage × window size (matches Claude's footer)
    const contextTokens = Math.round((usedPct / 100) * windowSize);

    const session: SessionState = {
      sessionId: data.session_id,
      name: deriveSessionName(data),
      status: "working",
      contextPct: usedPct,
      contextWindowSize: windowSize,
      tokensUsed: contextTokens,
      costUsd: data.cost?.total_cost_usd ?? 0,
      tokensPct: usedPct,
      model: data.model?.display_name ?? "unknown",
      cwd: data.cwd,
      tty: data.tty ?? "",
      lastUpdated: Date.now(),
    };

    updateSession(session);
  } catch (e) {
    console.error(`[session-watcher] error reading ${filePath}:`, e);
  }
}
