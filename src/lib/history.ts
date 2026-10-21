import type { DebateMessage, DebateMode } from "./debate";

export type SavedDebate = {
  id: string;
  topic: string;
  position: string;
  mode: DebateMode;
  createdAt: string;
  messages: DebateMessage[];
  status: "complete" | "stopped" | "error";
};

export type HistorySnapshot = {
  enabled: boolean;
  history: SavedDebate[];
  generation: number;
  clearedAt: number | null;
};

export const HISTORY_LIMIT = 30;
export const HISTORY_REQUEST_BYTES = 4 * 1024 * 1024;
export const HISTORY_DOCUMENT_BYTES = 800_000;

export class HistoryInputError extends Error {
  constructor(message = "토론 기록 형식이 올바르지 않습니다.", public readonly status = 400) {
    super(message);
    this.name = "HistoryInputError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function allowed(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).some(field => !fields.includes(field))) throw new HistoryInputError();
}

function text(value: unknown, maximum: number, required = false): string {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw new HistoryInputError();
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || /^__.*__$/.test(value)) throw new HistoryInputError();
  return value;
}

export function parseHistoryDebate(value: unknown, now = Date.now()): SavedDebate {
  allowed(value, ["id", "topic", "position", "mode", "createdAt", "messages", "status"]);
  if (value.mode !== "demo" && value.mode !== "live") throw new HistoryInputError();
  if (value.status !== "complete" && value.status !== "stopped" && value.status !== "error") throw new HistoryInputError();
  const createdAt = text(value.createdAt, 40, true);
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > now + 5 * 60_000) throw new HistoryInputError();
  if (!Array.isArray(value.messages) || value.messages.length > 9) throw new HistoryInputError();
  const ids = new Set<string>();
  const messages = value.messages.map(raw => {
    allowed(raw, ["id", "providerId", "round", "content", "status", "error"]);
    const id = identifier(raw.id);
    if (ids.has(id)) throw new HistoryInputError();
    ids.add(id);
    if (raw.providerId !== "gpt" && raw.providerId !== "claude" && raw.providerId !== "gemini") throw new HistoryInputError();
    if (raw.round !== 1 && raw.round !== 2 && raw.round !== 3) throw new HistoryInputError();
    if (raw.status !== "complete" && raw.status !== "error") throw new HistoryInputError();
    return {
      id, providerId: raw.providerId, round: raw.round, content: text(raw.content, 60_000), status: raw.status,
      ...(raw.error !== undefined ? { error: text(raw.error, 1000) } : {}),
    } satisfies DebateMessage;
  });
  const debate: SavedDebate = {
    id: identifier(value.id), topic: text(value.topic, 180, true), position: text(value.position, 4000),
    mode: value.mode, createdAt: new Date(timestamp).toISOString(), messages, status: value.status,
  };
  if (new TextEncoder().encode(JSON.stringify(debate)).byteLength > HISTORY_DOCUMENT_BYTES) throw new HistoryInputError("한 토론의 기록이 너무 큽니다.", 413);
  return debate;
}

export function parseHistoryGeneration(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new HistoryInputError();
  return value;
}

export function parseHistoryUpload(value: unknown, now = Date.now()): { history: SavedDebate[]; generation: number } {
  allowed(value, ["history", "generation"]);
  if (!Array.isArray(value.history) || value.history.length > HISTORY_LIMIT) throw new HistoryInputError();
  return { history: value.history.map(debate => parseHistoryDebate(debate, now)), generation: parseHistoryGeneration(value.generation) };
}

export function parseHistoryClear(value: unknown): number {
  allowed(value, ["generation"]);
  return parseHistoryGeneration(value.generation);
}

// Existing IDs are immutable. Retrying an upload cannot replace server content.
export function mergeHistory(existing: SavedDebate[], incoming: SavedDebate[], clearedAt: number | null = null): SavedDebate[] {
  const debates = new Map(existing.map(debate => [debate.id, debate]));
  for (const debate of incoming) {
    if (!debates.has(debate.id) && (clearedAt === null || Date.parse(debate.createdAt) > clearedAt)) debates.set(debate.id, debate);
  }
  return [...debates.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1)).slice(0, HISTORY_LIMIT);
}
