import { cookies } from "next/headers";
import { readCookie, readSiteSession, resolveAuthOrigin, sessionCookieName } from "./auth-core";
import { getRequestOrigin } from "./request-origin";

export function siteOrigin(request?: Request): string {
  return resolveAuthOrigin(request ? getRequestOrigin(request) : "http://localhost:3000", request?.headers.get("host") ?? null,
    process.env.AUTH_URL?.trim(), process.env.NODE_ENV === "production", process.env.VERCEL === "1");
}

export async function requestSiteUser(request: Request) {
  try { return await readSiteSession(readCookie(request, sessionCookieName(siteOrigin(request)))); }
  catch { return null; }
}

export async function currentSiteUser() {
  const jar = await cookies();
  const origin = process.env.AUTH_URL?.trim();
  try {
    // Vercel uses the HTTPS cookie; local HTTP development uses the unprefixed cookie.
    const value = origin ? jar.get(sessionCookieName(siteOrigin()))?.value : jar.get("__Host-prism-firebase-session")?.value ?? jar.get("prism-firebase-session")?.value;
    return await readSiteSession(value);
  } catch { return null; }
}

export async function denyAnonymous(request: Request): Promise<Response | null> {
  return await requestSiteUser(request) ? null : Response.json({ error: "Google 계정으로 로그인해주세요.", code: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
}
