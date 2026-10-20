import type { ConnectionTestRequest } from "../connection-test";
import { PROVIDERS, type ProviderId } from "../debate";
import { InputError, validateDebateRequest } from "./input";
import { callProvider } from "./providers";

export function validateConnectionTestRequest(value: unknown): ConnectionTestRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InputError("요청 형식이 올바르지 않습니다.");
  }
  const fields = value as Record<string, unknown>;
  if (!PROVIDERS.some((provider) => provider.id === fields.providerId)) {
    throw new InputError("지원하지 않는 AI 설정입니다.");
  }
  const providerId = fields.providerId as ProviderId;
  if (fields.gptAuthMode !== undefined && fields.gptAuthMode !== "api-key" && fields.gptAuthMode !== "chatgpt") throw new InputError("GPT 연결 방식을 확인해주세요.");
  const usePlan = providerId === "gpt" && fields.gptAuthMode === "chatgpt";
  const useLocal = providerId === "gemini" && fields.geminiAuthMode === "antigravity";
  // Share the debate's key/model format checks, without resolving environment keys.
  const settings = validateDebateRequest({
    topic: "연결 테스트",
    position: "연결 테스트",
    mode: "live",
    credentials: usePlan || useLocal ? undefined : { [providerId]: fields.apiKey },
    models: { [providerId]: fields.model },
    gptAccountId: fields.gptAccountId,
    geminiAuthMode: fields.geminiAuthMode,
  });
  const apiKey = settings.credentials?.[providerId];
  const model = settings.models?.[providerId];
  if (!apiKey && !usePlan && !useLocal) throw new InputError("테스트할 API 키를 입력해 주세요.");
  if (!model) throw new InputError("테스트할 모델을 선택해 주세요.");
  return { providerId, apiKey: apiKey || "", model, ...(usePlan ? { gptAuthMode: "chatgpt" as const, gptAccountId: settings.gptAccountId } : {}), ...(useLocal ? { geminiAuthMode: "antigravity" as const } : {}) };
}

export async function testProviderConnection(input: ConnectionTestRequest, signal: AbortSignal) {
  const started = performance.now();
  await callProvider({
    ...input,
    system: "This is an API connection test. Reply with OK only.",
    prompt: "Reply with OK only.",
    signal,
    timeoutMs: 25_000,
    authMode: input.gptAuthMode,
    geminiAuthMode: input.geminiAuthMode,
  });
  // Never expose generated content or the submitted key in the test result.
  return { ok: true as const, providerId: input.providerId, model: input.model, latencyMs: Math.max(0, Math.round(performance.now() - started)) };
}
