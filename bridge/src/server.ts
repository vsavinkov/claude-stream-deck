import http from "http";
import { unlinkSync } from "fs";
import { join } from "path";
import { WebSocketServer, WebSocket } from "ws";
import {
  BRIDGE_PORT,
  HookPayload,
  SESSIONS_DIR,
} from "./types.js";
import {
  getState,
  setSessionStatus,
  removeSession,
  onStateChange,
  cleanupStaleSessions,
} from "./state.js";
import { startSessionWatcher } from "./session-watcher.js";
import { startTokenAggregator } from "./token-aggregator.js";

// --- Start watchers ---
startSessionWatcher();
startTokenAggregator();

// --- Cleanup sweep every 5s (fast to catch iTerm tab closes) ---
setTimeout(cleanupStaleSessions, 5_000); // initial cleanup shortly after startup
setInterval(cleanupStaleSessions, 5_000);

// --- Debug web UI ---
function renderDebugHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Claude Bridge Debug</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  h1 { font-size: 18px; color: #fff; margin-bottom: 16px; }
  .meta { color: #888; font-size: 12px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { background: #252540; border-radius: 8px; padding: 14px; border-left: 4px solid #555; }
  .card.working { border-left-color: #eab308; }
  .card.waiting { border-left-color: #22c55e; }
  .card.finished { border-left-color: #22c55e; }
  .card.stopped { border-left-color: #ef4444; }
  .session-name { font-weight: 600; font-size: 15px; color: #fff; margin-bottom: 6px; }
  .session-id { font-size: 11px; color: #666; font-family: monospace; }
  .props { margin-top: 8px; font-size: 13px; line-height: 1.6; }
  .props .label { color: #888; display: inline-block; width: 70px; }
  .props .val { color: #ccc; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .status-badge.working { background: #eab30833; color: #eab308; }
  .status-badge.waiting { background: #22c55e33; color: #22c55e; }
  .status-badge.finished { background: #22c55e33; color: #22c55e; }
  .status-badge.stopped { background: #ef444433; color: #ef4444; }
  .totals { background: #252540; border-radius: 8px; padding: 14px; margin-bottom: 20px; display: flex; gap: 24px; }
  .totals .item { }
  .totals .label { color: #888; font-size: 11px; text-transform: uppercase; }
  .totals .value { color: #fff; font-size: 20px; font-weight: 700; }
  .empty { color: #555; font-style: italic; padding: 40px; text-align: center; }
  .bar { background: #333; border-radius: 3px; height: 6px; margin-top: 2px; }
  .bar-fill { height: 6px; border-radius: 3px; }
  .bar-fill.ctx { background: #7c3aed; }
  #ws-status { position: fixed; top: 8px; right: 12px; font-size: 11px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .dot.ok { background: #22c55e; }
  .dot.err { background: #ef4444; }
</style>
</head>
<body>
<h1>Claude Bridge Debug</h1>
<div id="ws-status"><span class="dot err"></span>connecting...</div>
<div id="totals" class="totals"></div>
<div id="grid" class="grid"><div class="empty">Waiting for data...</div></div>
<div class="meta" id="meta"></div>
<script>
let ws;
function connect() {
  ws = new WebSocket("ws://" + location.host);
  ws.onopen = () => {
    document.getElementById("ws-status").innerHTML = '<span class="dot ok"></span>live';
  };
  ws.onclose = () => {
    document.getElementById("ws-status").innerHTML = '<span class="dot err"></span>reconnecting...';
    setTimeout(connect, 2000);
  };
  ws.onmessage = (e) => {
    const state = JSON.parse(e.data);
    render(state);
  };
}
function fmt$(v) { return v < 0.01 ? "$0.00" : v < 0.1 ? "$" + v.toFixed(2) : "$" + v.toFixed(1); }
function fmtAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  return Math.floor(s/3600) + "h ago";
}
function render(state) {
  const sessions = Object.values(state.sessions);
  const grid = document.getElementById("grid");
  const totals = document.getElementById("totals");
  const meta = document.getElementById("meta");

  totals.innerHTML = '<div class="item"><div class="label">Sessions</div><div class="value">'
    + sessions.length + '</div></div>'
    + '<div class="item"><div class="label">Active</div><div class="value">'
    + sessions.filter(s => s.status === "working" || s.status === "waiting" || s.status === "finished").length + '</div></div>'
    + '<div class="item"><div class="label">Total Cost</div><div class="value">'
    + fmt$(state.totalCostUsd) + '</div></div>';

  if (sessions.length === 0) {
    grid.innerHTML = '<div class="empty">No active sessions</div>';
  } else {
    grid.innerHTML = sessions.map(s => {
      const age = fmtAge(Date.now() - s.lastUpdated);
      return '<div class="card ' + s.status + '">'
        + '<div class="session-name">' + esc(s.name || "(unnamed)") + '</div>'
        + '<span class="status-badge ' + s.status + '">' + s.status + '</span>'
        + ' <span style="color:#666;font-size:11px">' + age + '</span>'
        + '<div class="props">'
        + '<div><span class="label">Model</span><span class="val">' + esc(s.model) + '</span></div>'
        + '<div><span class="label">Context</span><span class="val">' + s.contextPct + '%</span>'
        + '<div class="bar"><div class="bar-fill ctx" style="width:' + s.contextPct + '%"></div></div></div>'
        + '<div><span class="label">Cost</span><span class="val">' + fmt$(s.costUsd) + '</span></div>'
        + '<div><span class="label">CWD</span><span class="val" style="font-size:11px;word-break:break-all">' + esc(s.cwd) + '</span></div>'
        + '<div><span class="label">TTY</span><span class="val" style="font-size:11px">' + esc(s.tty || "—") + '</span></div>'
        + '</div>'
        + '<div class="session-id">' + s.sessionId + '</div>'
        + '</div>';
    }).join("");
  }
  meta.textContent = "Last update: " + new Date().toLocaleTimeString();
}
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
connect();
</script>
</body>
</html>`;
}

// --- HTTP server for hooks + debug UI ---
const httpServer = http.createServer((req, res) => {
  // GET requests serve the debug UI
  if (req.method === "GET") {
    const url = req.url ?? "";
    if (url === "/" || url === "/debug") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderDebugHtml());
      return;
    }
    if (url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getState()));
      return;
    }
    res.writeHead(404).end("Not found");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const payload = body ? JSON.parse(body) : {};
      const url = req.url ?? "";
      console.log(`[http] ${url} payload keys: ${Object.keys(payload).join(", ")}`);
      const sessionId = payload.session_id;

      if (url === "/hook/notification" && sessionId) {
        setSessionStatus(sessionId, "waiting");
      } else if (url === "/hook/stop" && sessionId) {
        setSessionStatus(sessionId, "finished");
      } else if (url === "/hook/session-end" && sessionId) {
        setSessionStatus(sessionId, "stopped");
        // Remove from state and delete session file after brief flash of "stopped"
        setTimeout(() => {
          removeSession(sessionId);
          try { unlinkSync(join(SESSIONS_DIR, `${sessionId}.json`)); } catch {}
        }, 1000);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("[http] error:", e);
      res.writeHead(400).end();
    }
  });
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);
  // Send current state immediately
  ws.send(JSON.stringify(getState()));
  ws.on("close", () => clients.delete(ws));
});

// Broadcast on state change
onStateChange((state) => {
  const msg = JSON.stringify(state);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
});

// --- Start ---
httpServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
  console.log(`[bridge] listening on http://127.0.0.1:${BRIDGE_PORT}`);
});
