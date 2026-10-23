import { NextResponse } from "next/server";
import { cookieOptions, readCookie, sessionCookieName, verifyFirebaseIdentity } from "@/lib/server/auth-core";
import { requestSiteUser, siteOrigin } from "@/lib/server/site-auth";
import { InputError, readRequestJson } from "@/lib/server/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let origin: string;
  try { origin = siteOrigin(request); }
  catch { return Response.json({ error: "사이트 주소 설정을 확인해주세요." }, { status: 503 }); }
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
  // JSON requests plus an exact browser Origin check protect the session exchange from login CSRF.
  if (request.headers.get("origin") !== origin) return Response.json({ error: "이 사이트에서 로그인해주세요." }, { status: 403, headers });
  let idToken: string;
  try {
    const body = await readRequestJson(request) as { idToken?: unknown } | null;
    // Leave room for the cookie name and attributes within browsers' 4 KiB cookie limit.
    if (!body || typeof body.idToken !== "string" || !body.idToken || body.idToken.length > 3_800) throw new InputError("로그인 정보를 확인해주세요.");
    idToken = body.idToken;
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "로그인 정보를 확인해주세요." }, { status: error instanceof InputError ? error.status : 400, headers });
  }
  try {
    const identity = await verifyFirebaseIdentity(idToken);
    const previousUser = await requestSiteUser(request);
    const response = NextResponse.json({ user: identity.user }, { headers });
    const maxAge = Math.max(1, Math.min(3600, identity.expiresAt - Math.floor(Date.now() / 1000)));
    response.cookies.set(sessionCookieName(origin), idToken, cookieOptions(origin, maxAge));
    // Only clear on an actual account switch; an expired site cookie (e.g. after the
    // local server was off for over an hour) must not drop the ChatGPT plan session.
    if (previousUser && previousUser.id !== identity.user.id && readCookie(request, "agora_chatgpt_session")) response.cookies.set("agora_chatgpt_session", "", cookieOptions(origin, 0));
    return response;
  } catch { return Response.json({ error: "Google 계정으로 다시 로그인해주세요." }, { status: 401, headers }); }
}
