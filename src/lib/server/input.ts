import { PROVIDERS, type DebateConfiguration, type DebateRequest, type ProviderId } from "../debate";

export const MAX_REQUEST_BYTES = 32_768;

export class InputError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "InputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: unknown, label: string, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.trim().length > max) {
    throw new InputError(optional ? `${label}은(는) ${max}자 이내의 문자열로 입력해 주세요.` : `${label}은(는) 1~${max}자로 입력해 주세요.`);
  }
  return value.trim();
}

function overrides(value: unknown, type: "credentials" | "models"): Partial<Record<ProviderId, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InputError("API 설정 형식이 올바르지 않습니다.");
  const result: Partial<Record<ProviderId, string>> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!PROVIDERS.some((provider) => provider.id === id)) throw new InputError("지원하지 않는 AI 설정입니다.");
    if (typeof raw !== "string") throw new InputError("API 키와 모델 이름은 문자열이어야 합니다.");
    const normalized = raw.trim();
    if (!normalized) continue;
    if (type === "credentials") {
      if (normalized.length > 1024 || !/^[\x21-\x7E]+$/.test(normalized)) {
        throw new InputError("API 키 형식이 올바르지 않습니다. 공백 없이 다시 입력해 주세요.");
      }
    } else if (normalized.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(normalized)) {
      throw new InputError("모델 이름은 영문, 숫자, 마침표, 밑줄, 콜론, 하이픈으로 입력해 주세요.");
    }
    result[id as ProviderId] = normalized;
  }
  return result;
}

export function validateDebateRequest(value: unknown): DebateRequest {
  if (!isRecord(value)) throw new InputError("요청 형식이 올바르지 않습니다.");
  if (value.mode !== "demo" && value.mode !== "live") throw new InputError("데모 또는 실제 AI 모드를 선택해 주세요.");
  if (value.gptAuthMode !== undefined && value.gptAuthMode !== "api-key" && value.gptAuthMode !== "chatgpt") throw new InputError("GPT 연결 방식을 확인해주세요.");
  if (value.geminiAuthMode !== undefined && value.geminiAuthMode !== "api-key" && value.geminiAuthMode !== "antigravity") throw new InputError("Gemini 연결 방식을 확인해주세요.");
  if (value.gptAccountId !== undefined && (typeof value.gptAccountId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.gptAccountId))) throw new InputError("ChatGPT 계정 선택을 확인해주세요.");
  return {
    topic: textField(value.topic, "토론 주제", 180),
    position: textField(value.position, "나의 입론", 4000, true),
    mode: value.mode,
    credentials: overrides(value.credentials, "credentials"),
    models: overrides(value.models, "models"),
    ...(value.gptAuthMode !== undefined ? { gptAuthMode: value.gptAuthMode } : {}),
    ...(typeof value.gptAccountId === "string" ? { gptAccountId: value.gptAccountId } : {}),
    ...(value.geminiAuthMode !== undefined ? { geminiAuthMode: value.geminiAuthMode } : {}),
  };
}

export async function readRequestJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new InputError("application/json 형식으로 요청해 주세요.", 415);
  }
  if (!request.body) throw new InputError("요청 내용이 비어 있습니다.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new InputError("요청이 너무 큽니다.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("올바른 JSON 형식으로 요청해 주세요.");
  } finally {
    reader.releaseLock();
  }
}

const ENV_KEYS: Record<ProviderId, string> = {
  gpt: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};
const MODEL_ENV_KEYS: Record<ProviderId, string> = {
  gpt: "OPENAI_MODEL",
  claude: "ANTHROPIC_MODEL",
  gemini: "GEMINI_MODEL",
};

export function getConfiguration(): DebateConfiguration {
  const availableProviders = PROVIDERS.filter((provider) => Boolean(process.env[ENV_KEYS[provider.id]]?.trim())).map((provider) => provider.id);
  return {
    liveAvailable: availableProviders.length === PROVIDERS.length,
    availableProviders,
    missingProviders: PROVIDERS.filter((provider) => !availableProviders.includes(provider.id)).map((provider) => provider.id),
    providers: PROVIDERS.map((provider) => ({ ...provider, model: process.env[MODEL_ENV_KEYS[provider.id]]?.trim() || provider.model })),
  };
}

export function resolveSettings(input: DebateRequest, planAccessToken?: string, localCliAllowed = false) {
  const configuration = getConfiguration();
  const credentials: Record<ProviderId, string> = { gpt: "", claude: "", gemini: "" };
  const providers = configuration.providers.map((provider) => ({ ...provider, model: input.models?.[provider.id] || provider.model }));
  if (input.mode === "live") {
    for (const provider of providers) {
      if (provider.model.length > 120 || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(provider.model)) throw new InputError(`${provider.name} 모델 설정을 확인해 주세요.`, 422);
      if (provider.id === "gemini" && input.geminiAuthMode === "antigravity") {
        if (!localCliAllowed) throw new InputError("Google 구독 연결은 로컬 사이트에서만 사용할 수 있습니다.", 403);
        if (!/^gemini-[a-zA-Z0-9._-]{1,110}$/.test(provider.model)) throw new InputError("CLI 모델 목록에서 Gemini 모델을 선택해주세요.");
        continue;
      }
      if (provider.id === "gpt" && input.gptAuthMode === "chatgpt") {
        if (!planAccessToken) throw new InputError("설정에서 ChatGPT 계정을 연결해주세요.", 401);
        credentials.gpt = planAccessToken;
        continue;
      }
      const key = input.credentials?.[provider.id] || process.env[ENV_KEYS[provider.id]]?.trim() || "";
      if (!key) throw new InputError(`${provider.name} API 키를 설정에서 입력해 주세요.`, 422);
      if (key.length > 1024 || !/^[\x21-\x7E]+$/.test(key)) throw new InputError(`${provider.name} API 키 형식을 확인해 주세요.`, 422);
      credentials[provider.id] = key;
    }
  }
  return { providers, credentials, gptAuthMode: input.gptAuthMode, geminiAuthMode: input.geminiAuthMode };
}
