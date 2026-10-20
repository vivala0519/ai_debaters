export type GptAuthMode = "api-key" | "chatgpt";

export interface ChatGptAccountInfo {
  id: string;
  label: string;
  connected: boolean;
}

export interface ChatGptStatus {
  enabled: boolean;
  connected: boolean;
  activeAccountId: string | null;
  accounts: ChatGptAccountInfo[];
  welcomeRequired: boolean;
  message?: string;
}

export interface ChatGptModel {
  id: string;
  label: string;
}
