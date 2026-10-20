export type GeminiAuthMode = "api-key" | "antigravity";
export interface LocalGeminiModel { id: string; label: string }
export interface LocalGeminiStatus {
  enabled: boolean;
  installed: boolean;
  ready: boolean;
  models: LocalGeminiModel[];
  message: string;
}
