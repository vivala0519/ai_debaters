import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequestOrigin } from "./request-origin";

export interface PlanAccount {
  id: string;
  clientId: string;
  subject: string;
  email: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  scopes: string[];
  expiresAt: number;
  earliestRefreshAt?: number;
  acknowledged: boolean;
}

export interface PlanSession {
  accounts: PlanAccount[];
  activeAccountId: string | null;
  expiresAt: number;
}

export interface PendingLogin {
  sessionHash: string;
  origin: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
  accountId?: string;
  clientId?: string;
  expiresAt: number;
}

export interface PlanStore {
  hostId: string;
  sessions: Record<string, PlanSession>;
  pending: Record<string, PendingLogin>;
  completions: Record<string, { sessionHash: string; account: PlanAccount; expiresAt: number }>;
}

export const SESSION_COOKIE = "agora_chatgpt_session";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const hashSession = (id: string) => createHash("sha256").update(id).digest("hex");
export const randomOpaque = () => randomBytes(32).toString("base64url");

export function readSessionId(request: Request): string | null {
  const cookie = request.headers.get("cookie")?.split(";").find(part => part.trim().startsWith(`${SESSION_COOKIE}=`));
  const value = cookie?.trim().slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function isLocalPlanRequest(request: Request): boolean {
  const url = new URL(getRequestOrigin(request));
  const hostedOnVercel = process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development";
  return !hostedOnVercel && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
}

export function encryptStore(store: PlanStore, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(store), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("AGORA1"), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptStore(buffer: Buffer, key: Buffer): PlanStore {
  if (buffer.subarray(0, 6).toString() !== "AGORA1") throw new Error("Invalid credential store");
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(6, 18));
  decipher.setAuthTag(buffer.subarray(18, 34));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(34)), decipher.final()]).toString("utf8"));
}

// All tokens stay in the local Node runtime. File locking also serializes refresh
// token rotation across Next.js workers; writes replace the encrypted file atomically.
export async function withPlanStore<T>(operation: (store: PlanStore) => T | Promise<T>): Promise<T> {
  // Runtime credentials are deliberately excluded from build-time asset tracing.
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.AGORA_CHATGPT_AUTH_DIR || path.join(process.cwd(), ".agora"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = path.join(directory, "chatgpt.lock");
  const deadline = Date.now() + 40_000;
  while (true) {
    try {
      const lock = await open(lockPath, "wx", 0o600);
      await lock.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Recover a lock left by a crashed process. Normal operations have bounded
      // network timeouts and finish well before the stale threshold.
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 120_000) await unlink(lockPath).catch(() => {});
      if (Date.now() > deadline) throw new Error("Credential store is busy");
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  let temporary: string | undefined;
  try {
    const keyPath = path.join(directory, "chatgpt.key");
    let key: Buffer;
    try { key = await readFile(keyPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      key = randomBytes(32);
      await writeFile(keyPath, key, { flag: "wx", mode: 0o600 });
    }
    const storePath = path.join(directory, "chatgpt.enc");
    let store: PlanStore;
    try { store = decryptStore(await readFile(storePath), key); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      store = { hostId: `urn:uuid:${randomUUID()}`, sessions: {}, pending: {}, completions: {} };
    }
    const now = Date.now();
    for (const [id, session] of Object.entries(store.sessions)) if (session.expiresAt <= now) delete store.sessions[id];
    for (const [id, pending] of Object.entries(store.pending)) if (pending.expiresAt <= now) delete store.pending[id];
    for (const [id, completion] of Object.entries(store.completions)) if (completion.expiresAt <= now) delete store.completions[id];
    const result = await operation(store);
    temporary = path.join(directory, `chatgpt-${randomUUID()}.tmp`);
    await writeFile(temporary, encryptStore(store, key), { mode: 0o600 });
    await rename(temporary, storePath);
    return result;
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}
