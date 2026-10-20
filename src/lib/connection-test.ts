import type { ProviderId } from "./debate";

export interface ConnectionTestRequest {
  providerId: ProviderId;
  apiKey: string;
  model: string;
  gptAuthMode?: "api-key" | "chatgpt";
  gptAccountId?: string;
  geminiAuthMode?: "api-key" | "antigravity";
}

export type ConnectionTestResponse =
  | { ok: true; providerId: ProviderId; model: string; latencyMs: number }
  | { ok: false; error: string };
