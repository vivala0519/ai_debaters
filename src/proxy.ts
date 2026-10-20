import { NextResponse, type NextRequest } from "next/server";
import { requestSiteUser, siteOrigin } from "@/lib/server/site-auth";

const publicPaths = new Set(["/login", "/api/auth/firebase/session", "/api/auth/logout", "/api/auth/session"]);

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The existing ChatGPT callback authenticates its own pending OAuth state and returns to the original host.
  if (publicPaths.has(path) || path === "/api/auth/chatgpt/callback") return NextResponse.next();
  if (await requestSiteUser(request)) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return NextResponse.json({ error: "Google 계정으로 로그인해주세요.", code: "UNAUTHENTICATED" }, { status: 401, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
  }
  let origin: string;
  try { origin = siteOrigin(request); } catch { origin = request.nextUrl.origin; }
  const login = new URL("/login", origin);
  login.searchParams.set("next", `${path}${request.nextUrl.search}`);
  const response = NextResponse.redirect(login, 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|offline.html|icons/).*)"],
};
