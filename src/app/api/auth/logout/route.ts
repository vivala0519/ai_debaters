import { NextResponse } from "next/server";
import { cookieOptions, sessionCookieName } from "@/lib/server/auth-core";
import { siteOrigin } from "@/lib/server/site-auth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  let origin: string;
  try { origin = siteOrigin(request); } catch { return Response.json({ error: "로그인 설정을 확인해주세요." }, { status: 503 }); }
  if (request.headers.get("origin") !== origin) return Response.json({ error: "이 사이트에서 로그아웃해주세요." }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  for (const name of [sessionCookieName(origin), "prism-session", "__Host-prism-session", "agora_chatgpt_session"]) response.cookies.set(name, "", cookieOptions(origin, 0));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
