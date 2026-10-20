import type { ProviderId } from "../debate";
import type { GptAuthMode } from "../chatgpt";
import { PlanStreamError, readPlanResponse } from "./plan-stream";
import { callLocalGemini, LocalCliError } from "./antigravity";

export class ProviderError extends Error {
  constructor(message: string, public readonly status = 502) {
    super(message);
    this.name = "ProviderError";
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function extractProviderText(provider: ProviderId, data: unknown): string {
  const response = record(data);
  let text = "";
  if (provider === "gpt") {
    if (response.status === "incomplete") throw new ProviderError("출력 제한으로 답변이 중단되었습니다. 모델 설정을 확인해 주세요.");
    if (response.status === "failed" || response.error) throw new ProviderError("AI가 답변을 생성하지 못했습니다.");
    text = list(response.output).flatMap((item) => {
      const output = record(item);
      return output.type === "message" ? list(output.content) : [];
    }).filter((part) => record(part).type === "output_text").map((part) => record(part).text).filter((part): part is string => typeof part === "string").join("\n");
  } else if (provider === "claude") {
    if (response.stop_reason === "max_tokens") throw new ProviderError("출력 제한으로 답변이 중단되었습니다. 모델 설정을 확인해 주세요.");
    text = list(response.content).filter((part) => record(part).type === "text").map((part) => record(part).text).filter((part): part is string => typeof part === "string").join("\n");
  } else {
    const candidate = record(list(response.candidates)[0]);
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      throw new ProviderError(candidate.finishReason === "MAX_TOKENS" ? "출력 제한으로 답변이 중단되었습니다. 모델 설정을 확인해 주세요." : "AI가 이 요청의 답변을 완료하지 못했습니다.");
    }
    text = list(record(candidate.content).parts).filter((part) => record(part).thought !== true).map((part) => record(part).text).filter((part): part is string => typeof part === "string").join("\n");
  }
  if (!text.trim()) throw new ProviderError("AI가 텍스트 답변을 반환하지 않았습니다. 요청 또는 모델 설정을 확인해 주세요.");
  return text.trim();
}

function httpError(status: number): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("API 키 또는 모델 접근 권한을 확인해 주세요.", status);
  if (status === 429) return new ProviderError("API 사용 한도에 도달했습니다. 잔액과 요청 한도를 확인해 주세요.", 429);
  if (status === 404) return new ProviderError("모델을 찾을 수 없습니다. 설정의 모델 이름을 확인해 주세요.", 404);
  if (status >= 500) return new ProviderError("AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.");
  return new ProviderError("AI 요청이 거절되었습니다. API 설정과 입력 내용을 확인해 주세요.", 400);
}

export async function callProvider(options: {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
  timeoutMs?: number;
  authMode?: GptAuthMode;
  geminiAuthMode?: "api-key" | "antigravity";
}): Promise<string> {
  const { providerId, model, apiKey, system, prompt, signal } = options;
  if (providerId === "gemini" && options.geminiAuthMode === "antigravity") {
    try { return await callLocalGemini(options); }
    catch (error) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      if (error instanceof LocalCliError) throw new ProviderError(error.message, error.status);
      throw new ProviderError("로컬 Gemini 요청을 처리하지 못했습니다.");
    }
  }
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 65_000);
  const combined = AbortSignal.any([signal, timeout]);
  let url: string;
  let headers: Record<string, string>;
  let body: unknown;
  if (providerId === "gpt") {
    url = "https://api.openai.com/v1/responses";
    headers = { Authorization: `Bearer ${apiKey}` };
    body = options.authMode === "chatgpt"
      ? { model, instructions: system, input: [{ role: "user", content: prompt }], store: false, stream: true }
      : { model, instructions: system, input: prompt, max_output_tokens: 4096, store: false };
  } else if (providerId === "claude") {
    url = "https://api.anthropic.com/v1/messages";
    headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    body = { model, system, messages: [{ role: "user", content: prompt }], max_tokens: 4096 };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers = { "x-goog-api-key": apiKey };
    body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } };
  }
  try {
    combined.throwIfAborted();
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: combined, cache: "no-store", redirect: "error" });
    if (!response.ok) {
      // Never return or log upstream response bodies: they may contain submitted secrets.
      await response.body?.cancel();
      if (providerId === "gpt" && options.authMode === "chatgpt") {
        if (response.status === 401) throw new ProviderError("ChatGPT 인증이 만료되었습니다. 설정에서 다시 연결해주세요.", 401);
        if (response.status === 403) throw new ProviderError("ChatGPT 플랜 또는 선택한 모델의 접근 권한을 확인해주세요.", 403);
        if (response.status === 429) throw new ProviderError("ChatGPT 플랜 사용 한도에 도달했습니다. ChatGPT 사용량 설정을 확인해주세요.", 429);
      }
      throw httpError(response.status);
    }
    return providerId === "gpt" && options.authMode === "chatgpt" ? await readPlanResponse(response) : extractProviderText(providerId, await response.json());
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (timeout.aborted) throw new ProviderError("응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", 504);
    if (error instanceof ProviderError) throw error;
    if (error instanceof PlanStreamError) throw new ProviderError(error.message, error.status);
    throw new ProviderError("AI 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
