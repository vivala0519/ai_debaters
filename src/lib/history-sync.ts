import { mergeHistory, parseHistoryDebate, parseHistoryGeneration, type HistorySnapshot, type SavedDebate } from "./history";

export type HistorySyncState = {
  history: SavedDebate[];
  enabled: boolean | null;
  syncing: boolean;
  clearing: boolean;
  error: string | null;
};

export type HistorySyncMetadata = {
  // Legacy arrays have not observed any server generation yet.
  generation: number | null;
  knownIds: string[];
};

type Dependencies = {
  read: () => SavedDebate[];
  readMetadata?: () => HistorySyncMetadata;
  write: (history: SavedDebate[], metadata?: HistorySyncMetadata) => void;
  request: (init?: RequestInit) => Promise<Response>;
};

class SyncError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

const emptyMetadata = (): HistorySyncMetadata => ({ generation: null, knownIds: [] });
function validMetadata(value: HistorySyncMetadata | undefined): HistorySyncMetadata {
  if (!value || !(value.generation === null || Number.isSafeInteger(value.generation) && value.generation >= 0)
    || !Array.isArray(value.knownIds) || value.knownIds.length > 30 || !value.knownIds.every(id => typeof id === "string")) return emptyMetadata();
  return { generation: value.generation, knownIds: [...new Set(value.knownIds)] };
}

function validLocalHistory(history: SavedDebate[]): SavedDebate[] {
  return history.flatMap(value => {
    // Preserve older, long browser records even if they exceed cloud limits.
    // Explicitly project the record fields so credentials/settings never travel.
    if (!value || typeof value.id !== "string" || typeof value.topic !== "string" || typeof value.position !== "string"
      || !["demo", "live"].includes(value.mode) || !["complete", "stopped", "error"].includes(value.status)
      || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !Array.isArray(value.messages)
      || !value.messages.every(message => message && typeof message.id === "string" && ["gpt", "claude", "gemini"].includes(message.providerId)
        && [1, 2, 3].includes(message.round) && typeof message.content === "string" && ["complete", "error"].includes(message.status)
        && (message.error === undefined || typeof message.error === "string"))) return [];
    return [{ id: value.id, topic: value.topic, position: value.position, mode: value.mode, createdAt: value.createdAt, status: value.status,
      messages: value.messages.map(message => ({ id: message.id, providerId: message.providerId, round: message.round, content: message.content, status: message.status,
        ...(message.error !== undefined ? { error: message.error } : {}) })) }];
  });
}

async function responseSnapshot(response: Response): Promise<HistorySnapshot> {
  const data = await response.json();
  if (!response.ok) throw new SyncError(typeof data.error === "string" ? data.error : "기록을 동기화하지 못했습니다.", response.status);
  if (typeof data.enabled !== "boolean" || !Array.isArray(data.history) || data.history.length > 30
    || !(data.clearedAt === null || typeof data.clearedAt === "number" && Number.isFinite(data.clearedAt) && data.clearedAt >= 0)) throw new SyncError("기록 응답을 확인하지 못했습니다.");
  return { enabled: data.enabled, history: data.history.map((value: unknown) => parseHistoryDebate(value)), generation: parseHistoryGeneration(data.generation), clearedAt: data.clearedAt };
}

// Keep every upload below the API limit even when old local debates are long.
function uploadBatches(history: SavedDebate[]): SavedDebate[][] {
  const batches: SavedDebate[][] = [];
  let current: SavedDebate[] = [], size = 0;
  for (const debate of history) {
    const bytes = new TextEncoder().encode(JSON.stringify(debate)).byteLength;
    if (current.length && size + bytes > 3_500_000) { batches.push(current); current = []; size = 0; }
    current.push(debate); size += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function createHistorySync(dependencies: Dependencies) {
  let initial: SavedDebate[] = [];
  let metadata = emptyMetadata();
  try { initial = validLocalHistory(dependencies.read()); } catch { /* The cloud can still restore history. */ }
  try { metadata = validMetadata(dependencies.readMetadata?.()); } catch { /* Legacy caches have no acknowledgements. */ }
  let state: HistorySyncState = { history: mergeHistory([], initial), enabled: null, syncing: false, clearing: false, error: null };
  const listeners = new Set<(state: HistorySyncState) => void>();
  let queue = Promise.resolve();
  let disposed = false;
  let cacheError: string | null = null;

  function update(patch: Partial<HistorySyncState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  }
  function remember(history: SavedDebate[], nextMetadata = metadata) {
    const ids = new Set(history.map(debate => debate.id));
    metadata = { generation: nextMetadata.generation, knownIds: nextMetadata.knownIds.filter(id => ids.has(id)).slice(0, 30) };
    update({ history });
    try { dependencies.write(history, { ...metadata, knownIds: [...metadata.knownIds] }); cacheError = null; }
    catch {
      cacheError = "브라우저에 기록을 보관하지 못했습니다. 동기화 상태를 확인하고 필요하면 내보내기를 이용해주세요.";
      update({ error: cacheError });
    }
  }
  function readCachedHistory(preferDisk = false): { history: SavedDebate[]; metadata: HistorySyncMetadata } {
    let disk: SavedDebate[];
    let diskMetadata: HistorySyncMetadata;
    try {
      disk = validLocalHistory(dependencies.read());
      diskMetadata = validMetadata(dependencies.readMetadata?.());
    } catch { return { history: state.history, metadata }; }
    let memory = state.history;
    let nextMetadata = metadata;
    if (diskMetadata.generation !== null && (metadata.generation === null || diskMetadata.generation > metadata.generation)) {
      // Another tab already observed a clear. Its newer generation invalidates
      // our acknowledged records even when the device clock was ahead.
      const removed = new Set(metadata.knownIds);
      memory = memory.filter(debate => !removed.has(debate.id));
      nextMetadata = diskMetadata;
    } else if (metadata.generation !== null && diskMetadata.generation !== null && diskMetadata.generation < metadata.generation) {
      const removed = new Set(diskMetadata.knownIds);
      disk = disk.filter(debate => !removed.has(debate.id));
    } else if (metadata.generation === diskMetadata.generation) {
      nextMetadata = { generation: metadata.generation, knownIds: [...new Set([...metadata.knownIds, ...diskMetadata.knownIds])] };
    }
    return { history: preferDisk && !cacheError ? disk : mergeHistory(memory, disk), metadata: nextMetadata };
  }
  function applySnapshot(snapshot: HistorySnapshot) {
    const cached = readCachedHistory(!snapshot.enabled);
    if (!snapshot.enabled) { remember(cached.history, cached.metadata); return cached.history; }
    if (cached.metadata.generation !== null && snapshot.generation < cached.metadata.generation) throw new SyncError("최신 기록을 다시 확인하고 있습니다.", 409);
    const advanced = cached.metadata.generation !== null && snapshot.generation > cached.metadata.generation;
    const deleted = new Set(advanced ? cached.metadata.knownIds : []);
    const merged = mergeHistory(snapshot.history, cached.history.filter(debate => !deleted.has(debate.id)), snapshot.clearedAt);
    const acknowledged = cached.metadata.generation === snapshot.generation ? cached.metadata.knownIds : [];
    remember(merged, { generation: snapshot.generation, knownIds: [...new Set([...acknowledged, ...snapshot.history.map(debate => debate.id)])] });
    return merged;
  }
  function ensureActive() { if (disposed) throw new SyncError("기록 동기화가 종료되었습니다."); }
  const get = async () => {
    const snapshot = await responseSnapshot(await dependencies.request({ cache: "no-store" }));
    ensureActive();
    return snapshot;
  };
  const send = async (method: "POST" | "DELETE", body: unknown) => {
    const snapshot = await responseSnapshot(await dependencies.request({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" }));
    ensureActive();
    return snapshot;
  };
  function enqueue(operation: () => Promise<void>) {
    const work = queue.then(async () => {
      if (disposed) return;
      update({ syncing: true, error: cacheError });
      try { await operation(); }
      catch (error) {
        if (!disposed) update({ error: error instanceof SyncError ? error.message : "기록을 동기화하지 못했습니다. 기기의 기록은 유지되며 연결 후 다시 시도합니다." });
        throw error;
      } finally { update({ syncing: false, ...(cacheError && !state.error ? { error: cacheError } : {}) }); }
    });
    queue = work.catch(() => {});
    return work;
  }

  async function synchronize() {
    // A clear on another device can race an upload; refetch once using its marker.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let snapshot = await get();
        update({ enabled: snapshot.enabled });
        const merged = applySnapshot(snapshot);
        if (!snapshot.enabled) return;
        const known = new Set(snapshot.history.map(debate => debate.id));
        let localOnly = false;
        const incoming = merged.filter(debate => !known.has(debate.id)).flatMap(debate => {
          try { return [parseHistoryDebate(debate)]; }
          catch { localOnly = true; return []; }
        });
        for (const batch of uploadBatches(incoming)) {
          snapshot = await send("POST", { history: batch, generation: snapshot.generation });
          // Persist each successful batch before the next upload can race a clear.
          applySnapshot(snapshot);
        }
        if (localOnly) update({ error: "일부 기록은 크기나 형식 제한으로 이 기기에만 보관합니다. 해당 기록은 내보내기로 보관할 수 있습니다." });
        return;
      } catch (error) {
        if (!(error instanceof SyncError) || error.status !== 409 || attempt > 0) throw error;
      }
    }
  }

  return {
    getState: () => state,
    subscribe(listener: (value: HistorySyncState) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    refresh: () => enqueue(synchronize),
    save(debate: SavedDebate) {
      if (disposed) return Promise.reject(new SyncError("기록 동기화가 종료되었습니다."));
      if (state.clearing) return Promise.reject(new SyncError("기록 삭제가 끝난 뒤 토론을 저장해주세요."));
      const validated = validLocalHistory([debate])[0];
      if (!validated) return Promise.reject(new SyncError("토론 기록 형식을 확인하지 못했습니다."));
      const cached = readCachedHistory(state.enabled === false);
      remember(mergeHistory([validated], cached.history), cached.metadata);
      return enqueue(synchronize);
    },
    clear() {
      if (state.clearing) return queue;
      update({ clearing: true });
      const operation = enqueue(async () => {
        if (state.enabled === false) { remember([], { generation: metadata.generation, knownIds: [] }); return; }
        const snapshot = await get();
        update({ enabled: snapshot.enabled });
        if (snapshot.enabled) {
          try {
            const cleared = await send("DELETE", { generation: snapshot.generation });
            remember([], { generation: cleared.generation, knownIds: [] });
            return;
          }
          catch (error) {
            if (error instanceof SyncError && error.status === 409) {
              const fresh = await get();
              applySnapshot(fresh);
              throw new SyncError("다른 기기에서 기록이 변경되었습니다. 목록을 확인한 뒤 다시 삭제해주세요.");
            }
            throw error;
          }
        }
        remember([], { generation: metadata.generation, knownIds: [] });
      });
      return operation.finally(() => update({ clearing: false }));
    },
    dispose() { disposed = true; listeners.clear(); },
  };
}

export type HistorySync = ReturnType<typeof createHistorySync>;
