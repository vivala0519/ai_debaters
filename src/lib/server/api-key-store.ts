import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { ApiKeyInputError, getApiKeyStatus, parseApiKeyPatch, type ApiKeyCredentials, type ApiKeyStatus } from "../api-keys";
import { firebaseAdminConfigured, historyFirestore } from "./firebase-admin";

const COLLECTION = "prismApiKeys";
const STORE_ERROR = "API 키를 동기화하지 못했습니다. 서버 설정과 연결을 확인해주세요.";

type EncryptedApiKeys = { version: 1; iv: string; ciphertext: string; tag: string };

export class ApiKeyStoreError extends Error {
  readonly status = 503;
  constructor() { super(STORE_ERROR); this.name = "ApiKeyStoreError"; }
}

export interface ApiKeyRepository {
  read(documentId: string): Promise<unknown>;
  update(documentId: string, mutate: (previous: unknown) => EncryptedApiKeys): Promise<void>;
}

function ownerDocumentId(userId: string) {
  if (!userId || userId.length > 128) throw new ApiKeyStoreError();
  return createHash("sha256").update(userId).digest("hex");
}

function decodeBase64(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new ApiKeyStoreError();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length)) throw new ApiKeyStoreError();
  return bytes;
}

/** Each ciphertext is authenticated against its verified Firebase UID. */
export function createApiKeyStore(repository: ApiKeyRepository, encryptionKey: Buffer) {
  if (encryptionKey.length !== 32) throw new ApiKeyStoreError();
  const key = Buffer.from(encryptionKey);
  const aad = (userId: string) => Buffer.from(`prism-api-keys:v1:${userId}`, "utf8");

  function decrypt(userId: string, raw: unknown): ApiKeyCredentials {
    if (raw === undefined) return {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ApiKeyStoreError();
    const data = raw as EncryptedApiKeys;
    if (data.version !== 1 || typeof data.ciphertext !== "string" || data.ciphertext.length > 8_192) throw new ApiKeyStoreError();
    const decipher = createDecipheriv("aes-256-gcm", key, decodeBase64(data.iv, 12));
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(decodeBase64(data.tag, 16));
    const plaintext = Buffer.concat([decipher.update(decodeBase64(data.ciphertext)), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plaintext);
    // An empty credential object is valid after explicitly removing every key.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Object.keys(parsed).length) return {};
    const credentials = parseApiKeyPatch(parsed);
    if (Object.values(credentials).some(value => !value)) throw new ApiKeyStoreError();
    return credentials;
  }

  function encrypt(userId: string, credentials: ApiKeyCredentials): EncryptedApiKeys {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad(userId));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
    return { version: 1, iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
  }

  return {
    async read(userId: string): Promise<ApiKeyCredentials> {
      try { return decrypt(userId, await repository.read(ownerDocumentId(userId))); }
      catch { throw new ApiKeyStoreError(); }
    },
    async write(userId: string, input: unknown): Promise<ApiKeyStatus> {
      const patch = parseApiKeyPatch(input);
      try {
        const documentId = ownerDocumentId(userId);
        let status: ApiKeyStatus = getApiKeyStatus({});
        await repository.update(documentId, previous => {
          const credentials = decrypt(userId, previous);
          for (const provider of Object.keys(patch) as (keyof ApiKeyCredentials)[]) {
            if (patch[provider]) credentials[provider] = patch[provider];
            else delete credentials[provider];
          }
          status = getApiKeyStatus(credentials);
          return encrypt(userId, credentials);
        });
        return status;
      } catch (error) {
        if (error instanceof ApiKeyInputError) throw error;
        throw new ApiKeyStoreError();
      }
    },
  };
}

export function createFirestoreApiKeyRepository(db: Firestore): ApiKeyRepository {
  return {
    async read(documentId) { return (await db.collection(COLLECTION).doc(documentId).get()).data(); },
    async update(documentId, mutate) {
      const reference = db.collection(COLLECTION).doc(documentId);
      await db.runTransaction(async transaction => {
        const previous = (await transaction.get(reference)).data();
        transaction.set(reference, mutate(previous));
      });
    },
  };
}

function configuredStore() {
  const configuredKey = process.env.PRISM_API_KEYS_ENCRYPTION_KEY?.trim() || process.env.PRISM_CONNECTIONS_ENCRYPTION_KEY?.trim();
  if (!configuredKey) return null;
  try {
    const key = /^[a-fA-F0-9]{64}$/.test(configuredKey)
      ? Buffer.from(configuredKey, "hex")
      : /^[A-Za-z0-9_-]{43}=?$/.test(configuredKey)
        ? Buffer.from(configuredKey, "base64url")
        : decodeBase64(configuredKey, 32);
    if (key.length !== 32 || !firebaseAdminConfigured()) throw new ApiKeyStoreError();
    return createApiKeyStore(createFirestoreApiKeyRepository(historyFirestore()), key);
  } catch { throw new ApiKeyStoreError(); }
}

/** null means sync is disabled; configured storage failures always reject. */
export async function readSavedApiKeys(userId: string): Promise<ApiKeyCredentials | null> {
  return configuredStore()?.read(userId) ?? null;
}

export async function writeSavedApiKeys(userId: string, patch: unknown): Promise<ApiKeyStatus> {
  const store = configuredStore();
  if (!store) throw new ApiKeyStoreError();
  return store.write(userId, patch);
}
