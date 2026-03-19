export type AgentStatus = "waiting" | "working" | "finished" | "stopped";

export const STATUS_COLORS: Record<AgentStatus, string> = {
  waiting: "#22c55e",
  working: "#eab308",
  finished: "#22c55e",
  stopped: "#ef4444",
};

const BAR_MAX_WIDTH = 80;
const NAME_MAX_CHARS_PER_LINE = 12;

export interface ButtonData {
  name: string;
  slotIndex: number;
  status: AgentStatus;
  contextPct: number;
  costUsd: number;
  model: string;
}

function formatCost(usd: number): string {
  if (usd >= 10) return "$" + Math.round(usd);
  if (usd >= 1) return "$" + usd.toFixed(1);
  if (usd >= 0.01) return "$" + usd.toFixed(2);
  return "$0.00";
}

/** Word-wrap name into up to 3 lines of ~12 chars each */
function wrapName(name: string): string[] {
  const words = name.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (lines.length >= 2) {
      // Last line — just append remaining
      current += (current ? " " : "") + word;
    } else if (!current) {
      current = word;
    } else if ((current + " " + word).length <= NAME_MAX_CHARS_PER_LINE) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  // Truncate last line if too long
  if (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last.length > NAME_MAX_CHARS_PER_LINE + 2) {
      lines[lines.length - 1] = last.slice(0, NAME_MAX_CHARS_PER_LINE) + "…";
    }
  }

  return lines.slice(0, 3);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderButton(data: ButtonData): string {
  const borderColor = STATUS_COLORS[data.status];
  const ctxWidth = Math.round((data.contextPct / 100) * BAR_MAX_WIDTH);
  const costLabel = formatCost(data.costUsd);
  // Empty name = new session, show slot number large
  const isSlotNumber = !data.name.trim();

  let nameSvg: string;
  if (isSlotNumber) {
    nameSvg = `<text x="72" y="55" text-anchor="middle" fill="white"
        font-size="36" font-weight="bold" font-family="sans-serif">${data.slotIndex + 1}</text>`;
  } else {
    const nameLines = wrapName(data.name);
    const nameY = 22;
    const nameLineHeight = 14;
    nameSvg = nameLines
      .map((line, i) =>
        `<text x="72" y="${nameY + i * nameLineHeight}" text-anchor="middle" fill="white"
        font-size="13" font-weight="bold" font-family="sans-serif">${escapeXml(line)}</text>`)
      .join("\n  ");
  }

  // All bottom elements at fixed positions
  const costY = 132;
  const ctxBarY = 108;
  const ctxLabelY = 118;
  const modelY = 96;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
  <rect x="2" y="2" width="140" height="140" rx="10"
        fill="#1a1a2e" stroke="${borderColor}" stroke-width="8"/>
  ${nameSvg}
  <text x="72" y="${modelY}" text-anchor="middle" fill="#888"
        font-size="11" font-family="sans-serif">${escapeXml(data.model)}</text>
  <text x="12" y="${ctxLabelY}" fill="#aaa" font-size="11" font-family="sans-serif">ctx</text>
  <rect x="38" y="${ctxBarY}" width="${BAR_MAX_WIDTH}" height="10" rx="3" fill="#333"/>
  <rect x="38" y="${ctxBarY}" width="${ctxWidth}" height="10" rx="3" fill="#7c3aed"/>
  <text x="132" y="${ctxLabelY}" text-anchor="end" fill="white" font-size="11" font-family="sans-serif">${data.contextPct}%</text>
  <text x="72" y="${costY}" text-anchor="middle" fill="#aaa" font-size="12" font-family="sans-serif">${costLabel}</text>
</svg>`;
}

export function renderEmptyButton(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
  <rect x="2" y="2" width="140" height="140" rx="10"
        fill="#0d0d1a" stroke="#333" stroke-width="2"/>
  <text x="72" y="76" text-anchor="middle" fill="#444"
        font-size="14" font-family="sans-serif">—</text>
</svg>`;
}
