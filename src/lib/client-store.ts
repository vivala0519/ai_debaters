import type { DebateMessage, ProviderId } from "./debate";
import type { SavedDebate } from "./history";
import type { HistorySyncMetadata } from "./history-sync";
export type { SavedDebate } from "./history";

export type ApiSettings = {
  credentials: Record<ProviderId, string>;
  models: Record<ProviderId, string>;
  gptAuthMode?: "api-key" | "chatgpt";
  geminiAuthMode?: "api-key" | "antigravity";
};

export const SETTINGS_KEY = "agora-api-settings-v1";
export const HISTORY_KEY = "agora-debates-v1";
const scopedKey = (key: string) => `${key}:${typeof document !== "undefined" ? document.documentElement.dataset.userKey || "signed-out" : "signed-out"}`;
export const settingsStorageKey = () => scopedKey(SETTINGS_KEY);
// Connection modes and models (never API keys) persist across browser restarts.
export const PREFS_KEY = "agora-connection-prefs-v1";
export const prefsStorageKey = () => scopedKey(PREFS_KEY);
export function savePrefs(settings: ApiSettings) {
  try { localStorage.setItem(prefsStorageKey(), JSON.stringify({ models: settings.models, gptAuthMode: settings.gptAuthMode, geminiAuthMode: settings.geminiAuthMode })); } catch { /* Optional. */ }
}
export const historyStorageKey = () => scopedKey(HISTORY_KEY);

export function readSettings(): ApiSettings | null {
  try {
    const raw = sessionStorage.getItem(settingsStorageKey());
    const prefs = raw ? null : localStorage.getItem(prefsStorageKey());
    if (!raw && !prefs) return null;
    const data = raw ? JSON.parse(raw) : { ...JSON.parse(prefs!), credentials: { gpt: "", claude: "", gemini: "" } };
    const ids: ProviderId[] = ["gpt", "claude", "gemini"];
    if (!data.credentials || !data.models || !ids.every(id => typeof data.credentials[id] === "string" && typeof data.models[id] === "string")) return null;
    if (data.gptAuthMode !== undefined && data.gptAuthMode !== "api-key" && data.gptAuthMode !== "chatgpt") return null;
    if (data.geminiAuthMode !== undefined && data.geminiAuthMode !== "api-key" && data.geminiAuthMode !== "antigravity") return null;
    return data as ApiSettings;
  } catch { return null; }
}

export function readHistory(): SavedDebate[] {
  try {
    const stored = JSON.parse(localStorage.getItem(historyStorageKey()) || "[]");
    const data = stored?.version === 2 ? stored.history : stored;
    if (!Array.isArray(data)) return [];
    return data.filter(d => d && typeof d.id === "string" && typeof d.topic === "string" && typeof d.position === "string" && ["demo", "live"].includes(d.mode) && ["complete", "stopped", "error"].includes(d.status) && typeof d.createdAt === "string" && Number.isFinite(Date.parse(d.createdAt)) && Array.isArray(d.messages) && d.messages.every((m: DebateMessage) => m && typeof m.id === "string" && ["gpt", "claude", "gemini"].includes(m.providerId) && [1, 2, 3].includes(m.round) && typeof m.content === "string" && ["complete", "error"].includes(m.status) && (m.error === undefined || typeof m.error === "string"))).slice(0, 30);
  } catch { return []; }
}

export function readHistoryMetadata(): HistorySyncMetadata {
  try {
    const data = JSON.parse(localStorage.getItem(historyStorageKey()) || "[]");
    if (data?.version !== 2 || !(data.generation === null || Number.isSafeInteger(data.generation) && data.generation >= 0)
      || !Array.isArray(data.knownIds) || data.knownIds.length > 30 || !data.knownIds.every((id: unknown) => typeof id === "string")) return { generation: null, knownIds: [] };
    return { generation: data.generation, knownIds: [...new Set<string>(data.knownIds)] };
  } catch { return { generation: null, knownIds: [] }; }
}

export function saveDebate(debate: SavedDebate): SavedDebate[] {
  const history = [debate, ...readHistory().filter(item => item.id !== debate.id)].slice(0, 30);
  writeHistory(history);
  return history;
}

export function writeHistory(history: SavedDebate[], metadata = readHistoryMetadata()): void {
  const ids = new Set(history.map(debate => debate.id));
  // Records and their server acknowledgements share one atomic storage write.
  // A reload can never retain an old record while losing its clear generation.
  localStorage.setItem(historyStorageKey(), JSON.stringify({ version: 2, history, generation: metadata.generation,
    knownIds: [...new Set(metadata.knownIds)].filter(id => ids.has(id)).slice(0, 30) }));
}

export function debateMarkdown(debate: SavedDebate) {
  const labels = ["독립 입론", "상호 반박", "최종 입장"];
  return `# ${debate.topic}\n\n${debate.mode === "demo" ? "> 데모 토론: 실제 AI가 생성한 답변이 아닌 흐름 예시입니다.\n\n" : ""}${debate.position ? `나의 입론: ${debate.position}\n\n` : ""}${labels.map((label, index) => `## ${index + 1}라운드 · ${label}\n\n${debate.messages.filter(m => m.round === index + 1).map(m => `### ${{ gpt: "GPT", claude: "Claude", gemini: "Gemini" }[m.providerId]}\n\n${m.content}${m.status === "error" ? `\n\n오류: ${m.error ?? "응답 실패"}` : ""}`).join("\n\n")}`).join("\n\n")}\n`;
}
