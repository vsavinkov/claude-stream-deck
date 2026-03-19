// Shared state for dial actions — avoids circular dependency between model-dial and effort-dial

const MODELS = ["haiku", "sonnet", "opus", "opus 1M"] as const;
type ModelName = (typeof MODELS)[number];

const MODEL_IDS: Record<ModelName, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
  "opus 1M": "claude-opus-4-6[1m]",
};

const EFFORT_LEVELS = ["low", "medium", "high", "max"] as const;
type EffortLevel = (typeof EFFORT_LEVELS)[number];

const EFFORT_DISPLAY: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  max: "Max",
};

export interface SelectorLabels {
  prev: string;
  current: string;
  next: string;
}

let modelIndex = 3; // default to opus 1M
let effortIndex = 2; // default to high

export function getModelIndex(): number { return modelIndex; }
export function setModelIndex(i: number): void { modelIndex = i; }
export function getModelCount(): number { return MODELS.length; }
export function getModelId(): string { return MODEL_IDS[MODELS[modelIndex]]; }

export function getModelLabels(): SelectorLabels {
  return {
    prev: modelIndex > 0 ? MODELS[modelIndex - 1] : "",
    current: "🤖 " + MODELS[modelIndex].toUpperCase(),
    next: modelIndex < MODELS.length - 1 ? MODELS[modelIndex + 1] : "",
  };
}

export function getEffortIndex(): number { return effortIndex; }
export function setEffortIndex(i: number): void { effortIndex = i; }
export function getEffortCount(): number { return EFFORT_LEVELS.length; }
export function getEffortLevel(): EffortLevel { return EFFORT_LEVELS[effortIndex]; }

export function getEffortLabels(): SelectorLabels {
  return {
    prev: effortIndex > 0 ? EFFORT_DISPLAY[EFFORT_LEVELS[effortIndex - 1]] : "",
    current: "⚡ " + EFFORT_DISPLAY[EFFORT_LEVELS[effortIndex]].toUpperCase(),
    next: effortIndex < EFFORT_LEVELS.length - 1 ? EFFORT_DISPLAY[EFFORT_LEVELS[effortIndex + 1]] : "",
  };
}

// --- Permission mode ---

const PERM_MODES = ["acceptEdits", "bypassPermissions", "dontAsk", "plan", "auto"] as const;
type PermMode = (typeof PERM_MODES)[number];

const PERM_DISPLAY: Record<PermMode, string> = {
  acceptEdits: "Edits",
  bypassPermissions: "Bypass",
  dontAsk: "DontAsk",
  plan: "Plan",
  auto: "Auto",
};

let permIndex = 1; // default to bypassPermissions

export function getPermIndex(): number { return permIndex; }
export function setPermIndex(i: number): void { permIndex = i; }
export function getPermCount(): number { return PERM_MODES.length; }
export function getPermMode(): PermMode { return PERM_MODES[permIndex]; }

export function getPermLabels(): SelectorLabels {
  return {
    prev: permIndex > 0 ? PERM_DISPLAY[PERM_MODES[permIndex - 1]] : "",
    current: "☢️ " + PERM_DISPLAY[PERM_MODES[permIndex]].toUpperCase(),
    next: permIndex < PERM_MODES.length - 1 ? PERM_DISPLAY[PERM_MODES[permIndex + 1]] : "",
  };
}
