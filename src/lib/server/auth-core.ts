import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { firebaseConfig } from "../firebase-config";

export interface SiteUser { id: string; email: string; name: string; storageKey: string }
export const userStorageKey = (subject: string) => createHash("sha256").update(subject).digest("hex");
const firebaseKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"), { timeoutDuration: 10_000 });

export function resolveAuthOrigin(requestOrigin: string, host: string | null, configured: string | undefined, production: boolean, vercel = false): string {
  const local = (hostname: string) => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
  let url = new URL(configured || requestOrigin);
  if (!configured && host) {
    if (!/^(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::[0-9]{1,5})?$/.test(host)) throw new Error("Invalid site host");
    const external = new URL(`${url.protocol}//${host}`);
    if (vercel && !local(external.hostname)) external.protocol = "https:";
    if (vercel) url = external;
    else if ((local(url.hostname) || url.hostname === "0.0.0.0" || url.hostname === "[::]") && local(external.hostname) && external.port === url.port) url = external;
    else if (production && external.origin !== url.origin) throw new Error("Set AUTH_URL for this proxy");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || (url.protocol !== "https:" && !(local(url.hostname) && url.protocol === "http:"))) throw new Error("Invalid site origin");
  return url.origin;
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://prism.invalid");
    if (url.origin !== "https://prism.invalid" || /^\/(?:login|api|_next)(?:\/|$)/.test(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/"; }
}

export const sessionCookieName = (origin: string) => new URL(origin).protocol === "https:" ? "__Host-prism-firebase-session" : "prism-firebase-session";
export const cookieOptions = (origin: string, maxAge: number) => ({ httpOnly: true, secure: new URL(origin).protocol === "https:", sameSite: "lax" as const, path: "/", maxAge });

export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export async function verifyFirebaseIdentity(idToken: string, keys: JWTVerifyGetKey = firebaseKeys): Promise<{ user: SiteUser; expiresAt: number }> {
  if (!idToken || idToken.length > 16_384) throw new Error("Invalid Firebase token");
  const { payload } = await jwtVerify(idToken, keys, {
    algorithms: ["RS256"], issuer: `https://securetoken.google.com/${firebaseConfig.projectId}`, audience: firebaseConfig.projectId,
    requiredClaims: ["sub", "exp", "iat", "auth_time", "email", "email_verified", "firebase"], clockTolerance: 5,
  });
  const now = Math.floor(Date.now() / 1000);
  const firebase = payload.firebase as { sign_in_provider?: unknown; identities?: Record<string, unknown> } | undefined;
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 128
    || typeof payload.iat !== "number" || payload.iat > now + 5
    || typeof payload.auth_time !== "number" || payload.auth_time <= 0 || payload.auth_time > now + 5
    || typeof payload.exp !== "number" || payload.exp <= now
    || payload.email_verified !== true || typeof payload.email !== "string" || !payload.email || payload.email.length > 254
    || firebase?.sign_in_provider !== "google.com") throw new Error("Invalid Firebase Google identity");
  const googleIdentities = firebase.identities?.["google.com"];
  const googleSubject = Array.isArray(googleIdentities) && typeof googleIdentities[0] === "string" && googleIdentities[0] ? googleIdentities[0] : payload.sub;
  return {
    user: { id: payload.sub, email: payload.email, name: typeof payload.name === "string" && payload.name.trim() ? payload.name.slice(0, 100) : "Google 계정", storageKey: userStorageKey(googleSubject) },
    expiresAt: payload.exp,
  };
}

export async function readSiteSession(value: string | undefined): Promise<SiteUser | null> {
  try { return value ? (await verifyFirebaseIdentity(value)).user : null; }
  catch { return null; }
}
