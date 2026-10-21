import type { ProviderId } from "./debate";

export type ApiKeyCredentials = Partial<Record<ProviderId, string>>;

export interface ApiKeyStatus {
  enabled: boolean;
  configuredProviders: ProviderId[];
}

export const API_KEY_PROVIDERS: readonly ProviderId[] = ["gpt", "claude", "gemini"];
export const API_KEY_OWNER_HEADER = "X-Prism-Api-Key-Owner";
export const API_KEY_REQUEST_BYTES = 8_192;

export class ApiKeyInputError extends Error {
  constructor(message = "API 키 설정을 확인해주세요.", readonly status = 400) {
    super(message);
    this.name = "ApiKeyInputError";
  }
}

/** Omitted providers are preserved; an empty string explicitly removes a key. */
export function parseApiKeyPatch(input: unknown): ApiKeyCredentials {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiKeyInputError();
  const entries = Object.entries(input);
  if (!entries.length || entries.some(([provider]) => !API_KEY_PROVIDERS.includes(provider as ProviderId))) throw new ApiKeyInputError();
  const patch: ApiKeyCredentials = {};
  for (const [provider, value] of entries) {
    if (typeof value !== "string") throw new ApiKeyInputError();
    const key = value.trim();
    if (key.length > 1_024 || (key && !/^[\x21-\x7e]+$/.test(key))) throw new ApiKeyInputError("API 키에는 공백 없는 영문·숫자·기호를 입력해주세요.");
    patch[provider as ProviderId] = key;
  }
  return patch;
}

export function getApiKeyStatus(credentials: ApiKeyCredentials | null): ApiKeyStatus {
  return {
    enabled: credentials !== null,
    configuredProviders: API_KEY_PROVIDERS.filter(provider => Boolean(credentials?.[provider])),
  };
}
