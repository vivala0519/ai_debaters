export type ProviderId = "gpt" | "claude" | "gemini";
export type DebateRound = 1 | 2 | 3;
export type DebateMode = "demo" | "live";

export interface Provider {
  id: ProviderId;
  name: string;
  company: string;
  model: string;
  color: string;
  description: string;
}

export const PROVIDERS: readonly Provider[] = [
  { id: "gpt", name: "GPT", company: "OpenAI", model: "gpt-5.4-mini", color: "#537967", description: "논리를 연결하고 근거를 검토합니다" },
  { id: "claude", name: "Claude", company: "Anthropic", model: "claude-sonnet-5-5", color: "#C0785D", description: "전제를 살피고 다른 관점을 제안합니다" },
  { id: "gemini", name: "Gemini", company: "Google", model: "gemini-3.8-flash", color: "#6478BB", description: "쟁점을 확장하고 가능성을 탐색합니다" },
];

export const ROUNDS: readonly { id: DebateRound; title: string; description: string }[] = [
  { id: 1, title: "독립 입론", description: "서로의 의견을 보지 않고 각자의 관점을 제시합니다." },
  { id: 2, title: "상호 반박", description: "다른 두 AI의 입론을 읽고 논거를 검토합니다." },
  { id: 3, title: "최종 입장", description: "반박에 답하고 수정된 최종 입장을 정리합니다." },
];

export interface DebateMessage {
  id: string;
  providerId: ProviderId;
  round: DebateRound;
  content: string;
  status: "complete" | "error";
  error?: string;
}

export interface DebateRequest {
  topic: string;
  position: string;
  mode: DebateMode;
  credentials?: Partial<Record<ProviderId, string>>;
  models?: Partial<Record<ProviderId, string>>;
  gptAuthMode?: "api-key" | "chatgpt";
  gptAccountId?: string;
  geminiAuthMode?: "api-key" | "antigravity";
}

export type DebateEvent =
  | { type: "start"; debateId: string; mode: DebateMode; providers: Provider[] }
  | { type: "round-start"; round: DebateRound }
  | { type: "message"; message: DebateMessage }
  | { type: "round-complete"; round: DebateRound }
  | { type: "complete"; debateId: string; hasErrors: boolean }
  | { type: "error"; message: string };

export interface DebateConfiguration {
  liveAvailable: boolean;
  availableProviders: ProviderId[];
  missingProviders: ProviderId[];
  providers: Provider[];
  chatgptConnected?: boolean;
  chatgptAccountId?: string | null;
  geminiLocalReady?: boolean;
}
