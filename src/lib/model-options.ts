import type { ProviderId } from "./debate";

export interface ModelOption {
  id: string;
  label: string;
}

// Text generation models verified against official catalogs on 2026-10-19:
// https://developers.openai.com/api/docs/models/gpt-6.1-sol
// https://developers.openai.com/api/docs/models/gpt-5.4-mini
// https://developers.openai.com/api/docs/models/gpt-5.4
// https://developers.openai.com/api/docs/models/gpt-5.5
// https://platform.claude.com/docs/en/models/overview
// https://ai.google.dev/gemini-api/docs/models
export const MODEL_OPTIONS: Record<ProviderId, readonly ModelOption[]> = {
  gpt: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.5", label: "GPT-5.5" },
  ],
  claude: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  ],
  gemini: [
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
    { id: "gemini-4-argon", label: "Gemini 4 Argon" },
    { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  ],
};

export function getModelOptions(provider: ProviderId, currentModel?: string): readonly ModelOption[] {
  const options = MODEL_OPTIONS[provider];
  if (!currentModel || options.some(option => option.id === currentModel)) return options;
  // Preserve previously saved IDs and snapshots when changing the input to a select.
  return [...options, { id: currentModel, label: `${currentModel} · 기존 설정` }];
}
