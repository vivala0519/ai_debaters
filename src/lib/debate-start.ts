import { PROVIDERS, type DebateConfiguration, type DebateMode, type DebateRequest, type ProviderId } from "./debate";
import type { ApiKeyStatus } from "./api-keys";
import type { ApiSettings } from "./client-store";

export interface DebateStartParticipant {
  id: ProviderId;
  name: string;
  connection: string;
  model: string;
  ready: boolean;
}

export interface DebateStartConfiguration extends DebateConfiguration {
  apiKeys: ApiKeyStatus;
}

export interface PreparedDebateStart {
  request: DebateRequest;
  participants: DebateStartParticipant[];
  ready: boolean;
}

/** Freeze the reviewed settings into the same payload used after confirmation. */
export function prepareDebateStart(
  topic: string,
  position: string,
  mode: DebateMode,
  settings: ApiSettings | null,
  configuration: DebateStartConfiguration,
): PreparedDebateStart {
  const request: DebateRequest = { topic: topic.trim(), position: position.trim(), mode };
  if (mode === "demo") {
    return {
      request,
      participants: PROVIDERS.map(provider => ({
        id: provider.id, name: provider.name, connection: "데모", model: "미리 작성된 응답", ready: true,
      })),
      ready: true,
    };
  }

  const gptAuthMode = settings?.gptAuthMode ?? "api-key";
  const geminiAuthMode = settings?.geminiAuthMode ?? "api-key";
  const models: Record<ProviderId, string> = { gpt: "", claude: "", gemini: "" };
  const credentials: Partial<Record<ProviderId, string>> = {};
  const participants = PROVIDERS.map(provider => {
    const usePlan = provider.id === "gpt" && gptAuthMode === "chatgpt";
    const useLocal = provider.id === "gemini" && geminiAuthMode === "antigravity";
    const key = settings?.credentials[provider.id]?.trim() ?? "";
    const model = settings?.models[provider.id]?.trim()
      || configuration.providers.find(item => item.id === provider.id)?.model.trim()
      || provider.model;
    models[provider.id] = model;
    if (!configuration.apiKeys.enabled && !usePlan && !useLocal && key) credentials[provider.id] = key;
    const apiReady = configuration.apiKeys.enabled
      ? configuration.apiKeys.configuredProviders.includes(provider.id)
      : configuration.availableProviders.includes(provider.id) || Boolean(key);
    return {
      id: provider.id,
      name: provider.name,
      connection: usePlan ? "ChatGPT 플랜" : useLocal ? "Google 플랜 · 로컬 CLI" : "API 키",
      model,
      ready: usePlan ? configuration.chatgptConnected === true : useLocal ? configuration.geminiLocalReady === true : apiReady,
    };
  });
  request.models = models;
  request.gptAuthMode = gptAuthMode;
  request.geminiAuthMode = geminiAuthMode;
  if (Object.keys(credentials).length) request.credentials = credentials;
  if (gptAuthMode === "chatgpt" && configuration.chatgptAccountId) request.gptAccountId = configuration.chatgptAccountId;
  return { request, participants, ready: participants.every(participant => participant.ready) };
}
