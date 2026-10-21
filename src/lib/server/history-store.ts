import "server-only";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { HISTORY_LIMIT, mergeHistory, parseHistoryClear, parseHistoryDebate, parseHistoryUpload, type HistorySnapshot } from "../history";
import { firebaseAdminConfigurationPresent, firebaseAdminConfigured, historyFirestore } from "./firebase-admin";

const STORE_ERROR = "토론 기록을 동기화하지 못했습니다. 서버 설정과 연결을 확인해주세요.";
const COLLECTION = "prismHistory";
type HistoryState = Omit<HistorySnapshot, "enabled">;
type Metadata = { version: 1; generation: number; clearedAt: number | null; revision: number; cleanupPending: boolean };

export class HistoryStoreError extends Error {
  readonly status = 503;
  constructor() { super(STORE_ERROR); this.name = "HistoryStoreError"; }
}

export class HistoryConflictError extends Error {
  readonly status = 409;
  constructor() { super("다른 기기에서 기록이 변경되었습니다. 최신 기록을 다시 불러와주세요."); this.name = "HistoryConflictError"; }
}

// A repository must serialize each owner's read-modify-write operations. Reads
// include metadata and records from the same transaction snapshot.
export interface HistoryRepository {
  read(documentId: string): Promise<HistoryState>;
  update(documentId: string, mutate: (previous: HistoryState) => HistoryState, metadataOnly?: boolean): Promise<HistoryState>;
  cleanup(documentId: string): Promise<void>;
}

const emptyState = (): HistoryState => ({ history: [], generation: 0, clearedAt: null });
const snapshot = (state: HistoryState, enabled = true): HistorySnapshot => ({ enabled, ...state });
const userDocumentId = (userId: string) => {
  if (!userId || userId.length > 128) throw new HistoryStoreError();
  return createHash("sha256").update(userId).digest("hex");
};

function sanitizeState(state: HistoryState, now = Date.now()): HistoryState {
  if (!Number.isSafeInteger(state.generation) || state.generation < 0 || (state.clearedAt !== null && (!Number.isSafeInteger(state.clearedAt) || state.clearedAt < 0)) || !Array.isArray(state.history) || state.history.length > HISTORY_LIMIT) throw new HistoryStoreError();
  return { generation: state.generation, clearedAt: state.clearedAt, history: state.history.map(debate => parseHistoryDebate(debate, now)) };
}

export function createHistoryStore(repository: HistoryRepository, now = Date.now) {
  return {
    async get(userId: string): Promise<HistorySnapshot> {
      try { return snapshot(sanitizeState(await repository.read(userDocumentId(userId)), now())); }
      catch { throw new HistoryStoreError(); }
    },
    async append(userId: string, input: unknown): Promise<HistorySnapshot> {
      const upload = parseHistoryUpload(input, now());
      try {
        const owner = userDocumentId(userId);
        await repository.update(owner, previous => {
          const state = sanitizeState(previous, now());
          if (state.generation !== upload.generation) throw new HistoryConflictError();
          return { ...state, history: mergeHistory(state.history, upload.history, state.clearedAt) };
        });
        await repository.cleanup(owner);
        return snapshot(sanitizeState(await repository.read(owner), now()));
      } catch (error) {
        if (error instanceof HistoryConflictError) throw error;
        throw new HistoryStoreError();
      }
    },
    async clear(userId: string, input: unknown): Promise<HistorySnapshot> {
      const generation = parseHistoryClear(input);
      try {
        const owner = userDocumentId(userId);
        try {
          await repository.update(owner, previous => {
            const state = sanitizeState(previous, now());
            if (state.generation !== generation) throw new HistoryConflictError();
            if (state.generation >= Number.MAX_SAFE_INTEGER - 1) throw new HistoryStoreError();
            return { history: [], generation: state.generation + 1, clearedAt: Math.max(now(), (state.clearedAt ?? -1) + 1) };
          }, true);
        } catch (error) {
          // A prior clear can have committed before bounded physical deletion
          // failed. Retrying still finishes that deletion before returning 409.
          if (error instanceof HistoryConflictError) await repository.cleanup(owner);
          throw error;
        }
        await repository.cleanup(owner);
        return snapshot(sanitizeState(await repository.read(owner), now()));
      } catch (error) {
        if (error instanceof HistoryConflictError) throw error;
        throw new HistoryStoreError();
      }
    },
  };
}

function readMetadata(raw: unknown): Metadata {
  if (raw === undefined) return { version: 1, generation: 0, clearedAt: null, revision: 0, cleanupPending: false };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new HistoryStoreError();
  const data = raw as Metadata;
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.cleanupPending !== "boolean") throw new HistoryStoreError();
  sanitizeState({ generation: data.generation, clearedAt: data.clearedAt, history: [] });
  return data;
}

export function createFirestoreHistoryRepository(db: Firestore): HistoryRepository {
  const repository: HistoryRepository = {
    async read(documentId) {
      const ref = db.collection(COLLECTION).doc(documentId);
      const result = await db.runTransaction(async transaction => {
        const metadata = readMetadata((await transaction.get(ref)).data());
        const records = await transaction.get(ref.collection("generations").doc(String(metadata.generation)).collection("debates").orderBy("createdAt", "desc").limit(HISTORY_LIMIT));
        return { state: { generation: metadata.generation, clearedAt: metadata.clearedAt, history: records.docs.map(doc => parseHistoryDebate(doc.data())) }, cleanupPending: metadata.cleanupPending };
      }, { readOnly: true });
      if (result.cleanupPending) {
        await repository.cleanup(documentId);
        return repository.read(documentId);
      }
      return result.state;
    },
    async update(documentId, mutate, metadataOnly = false) {
      const ref = db.collection(COLLECTION).doc(documentId);
      return db.runTransaction(async transaction => {
        const metadata = readMetadata((await transaction.get(ref)).data());
        const generationRef = ref.collection("generations").doc(String(metadata.generation));
        const records = metadataOnly ? [] : (await transaction.get(generationRef.collection("debates").orderBy("createdAt", "desc").limit(HISTORY_LIMIT))).docs;
        const previous = { generation: metadata.generation, clearedAt: metadata.clearedAt, history: records.map(doc => parseHistoryDebate(doc.data())) };
        const next = sanitizeState(mutate(previous));
        const existingIds = new Set(previous.history.map(debate => debate.id));
        if (!metadataOnly) {
          for (const debate of next.history) {
            if (!existingIds.has(debate.id)) transaction.create(generationRef.collection("debates").doc(debate.id), debate);
          }
          if (next.history.length) transaction.set(generationRef, { version: 1 });
        }
        // Touching one metadata document serializes uploads from separate devices.
        transaction.set(ref, { version: 1, generation: next.generation, clearedAt: next.clearedAt, revision: metadata.revision + 1, cleanupPending: metadataOnly || metadata.cleanupPending } satisfies Metadata);
        return next;
      });
    },
    async cleanup(documentId) {
      const ref = db.collection(COLLECTION).doc(documentId);
      const current = readMetadata((await ref.get()).data());
      const generations = await ref.collection("generations").get();
      for (const generation of generations.docs) {
        const generationNumber = Number(generation.id);
        if (!Number.isSafeInteger(generationNumber) || generationNumber > current.generation) continue;
        const old = generationNumber < current.generation;
        // Small delete batches also remain below Firestore's transaction/request
        // size limits when each debate approaches the document size cap.
        while (true) {
          const records = await generation.ref.collection("debates").orderBy("createdAt", "desc").offset(old ? 0 : HISTORY_LIMIT).limit(5).get();
          if (records.empty) break;
          const batch = db.batch();
          for (const debate of records.docs) batch.delete(debate.ref);
          await batch.commit();
        }
        if (old) await generation.ref.delete();
      }
      if (current.cleanupPending) await db.runTransaction(async transaction => {
        const latest = readMetadata((await transaction.get(ref)).data());
        if (latest.generation === current.generation && latest.cleanupPending) transaction.update(ref, { cleanupPending: false });
      });
    },
  };
  return repository;
}

function configuredStore() {
  if (!firebaseAdminConfigured()) {
    if (firebaseAdminConfigurationPresent()) throw new HistoryStoreError();
    return null;
  }
  return createHistoryStore(createFirestoreHistoryRepository(historyFirestore()));
}

export async function getHistory(userId: string): Promise<HistorySnapshot> {
  try { return await configuredStore()?.get(userId) ?? snapshot(emptyState(), false); }
  catch { throw new HistoryStoreError(); }
}

export async function appendHistory(userId: string, input: unknown): Promise<HistorySnapshot> {
  const store = configuredStore();
  if (!store) throw new HistoryStoreError();
  return store.append(userId, input);
}

export async function clearHistory(userId: string, input: unknown): Promise<HistorySnapshot> {
  const store = configuredStore();
  if (!store) throw new HistoryStoreError();
  return store.clear(userId, input);
}
