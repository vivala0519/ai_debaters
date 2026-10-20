import type { DebateMessage, DebateMode, ProviderId } from "./debate";

export type ApiSettings = {
  credentials: Record<ProviderId, string>;
  models: Record<ProviderId, string>;
  gptAuthMode?: "api-key" | "chatgpt";
  geminiAuthMode?: "api-key" | "antigravity";
};

export type SavedDebate = {
  id: string;
  topic: string;
  position: string;
  mode: DebateMode;
  createdAt: string;
  messages: DebateMessage[];
  status: "complete" | "stopped" | "error";
};

export const SETTINGS_KEY = "agora-api-settings-v1";
export const HISTORY_KEY = "agora-debates-v1";

export function readSettings(): ApiSettings | null {
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const ids: ProviderId[] = ["gpt", "claude", "gemini"];
    if (!data.credentials || !data.models || !ids.every(id => typeof data.credentials[id] === "string" && typeof data.models[id] === "string")) return null;
    if (data.gptAuthMode !== undefined && data.gptAuthMode !== "api-key" && data.gptAuthMode !== "chatgpt") return null;
    if (data.geminiAuthMode !== undefined && data.geminiAuthMode !== "api-key" && data.geminiAuthMode !== "antigravity") return null;
    return data as ApiSettings;
  } catch { return null; }
}

export function readHistory(): SavedDebate[] {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(d => d && typeof d.id === "string" && typeof d.topic === "string" && typeof d.position === "string" && ["demo", "live"].includes(d.mode) && ["complete", "stopped", "error"].includes(d.status) && typeof d.createdAt === "string" && Number.isFinite(Date.parse(d.createdAt)) && Array.isArray(d.messages) && d.messages.every((m: DebateMessage) => m && typeof m.id === "string" && ["gpt", "claude", "gemini"].includes(m.providerId) && [1, 2, 3].includes(m.round) && typeof m.content === "string" && ["complete", "error"].includes(m.status) && (m.error === undefined || typeof m.error === "string"))).slice(0, 30);
  } catch { return []; }
}

export function saveDebate(debate: SavedDebate): SavedDebate[] {
  const history = [debate, ...readHistory().filter(item => item.id !== debate.id)].slice(0, 30);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

export function debateMarkdown(debate: SavedDebate) {
  const labels = ["독립 입론", "상호 반박", "최종 입장"];
  return `# ${debate.topic}\n\n${debate.mode === "demo" ? "> 데모 토론: 실제 AI가 생성한 답변이 아닌 흐름 예시입니다.\n\n" : ""}나의 입론: ${debate.position}\n\n${labels.map((label, index) => `## ${index + 1}라운드 · ${label}\n\n${debate.messages.filter(m => m.round === index + 1).map(m => `### ${{ gpt: "GPT", claude: "Claude", gemini: "Gemini" }[m.providerId]}\n\n${m.content}${m.status === "error" ? `\n\n오류: ${m.error ?? "응답 실패"}` : ""}`).join("\n\n")}`).join("\n\n")}\n`;
}
