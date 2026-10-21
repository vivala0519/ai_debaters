import "server-only";
import { readCookie, sessionCookieName } from "./auth-core";
import { firebaseAdminConfigurationPresent, firebaseAdminConfigured } from "./firebase-admin";
import { siteOrigin } from "./site-auth";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Content-Type": "application/json; charset=utf-8" };
const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class HistoryRelayError extends Error {
  readonly status = 503;
  constructor() { super("배포 사이트에 기록을 동기화하지 못했습니다. 연결 주소와 서버 설정을 확인해주세요."); this.name = "HistoryRelayError"; }
}

/** Local development can use the deployed history API without copying admin keys. */
export async function relayHistoryRequest(request: Request, userId: string, input?: unknown): Promise<Response | null> {
  // Direct Firebase storage takes precedence. Never relay from a Vercel deployment
  // or hide a partially configured local service account behind a fallback.
  if (process.env.VERCEL === "1" || firebaseAdminConfigured() || firebaseAdminConfigurationPresent()) return null;
  const configured = process.env.PRISM_HISTORY_SYNC_ORIGIN?.trim();
  if (!configured) return null;
  try {
    const source = siteOrigin(request);
    const target = new URL(configured);
    if (!localHosts.has(new URL(source).hostname) || target.protocol !== "https:" || localHosts.has(target.hostname)
      || target.username || target.password || target.pathname !== "/" || target.search || target.hash || target.origin === source) throw new HistoryRelayError();
    if (!["GET", "POST", "DELETE"].includes(request.method) || !userId || request.headers.get("x-prism-history-owner") !== userId) throw new HistoryRelayError();
    if (request.method !== "GET" && request.headers.get("origin") !== source) throw new HistoryRelayError();
    // The route has already verified this Firebase session. Forward only that
    // identity to the fixed, trusted deployment, never other cookies or AI keys.
    const token = readCookie(request, sessionCookieName(source));
    if (!token) throw new HistoryRelayError();
    const response = await fetch(new URL("/api/history", target), {
      method: request.method,
      headers: {
        Cookie: `${sessionCookieName(target.origin)}=${token}`,
        "X-Prism-History-Owner": userId,
        ...(request.method !== "GET" ? { Origin: target.origin, "Content-Type": "application/json" } : {}),
      },
      ...(request.method !== "GET" ? { body: JSON.stringify(input) } : {}),
      cache: "no-store", redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(18_000)]),
    });
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      await response.body?.cancel(); throw new HistoryRelayError();
    }
    // Stream large history responses; never forward Set-Cookie or upstream headers.
    return new Response(response.body, { status: response.status, headers });
  } catch { throw new HistoryRelayError(); }
}
