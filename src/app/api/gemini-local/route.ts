import { getLocalGeminiStatus } from "@/lib/server/antigravity";
import { denyAnonymous } from "@/lib/server/site-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  const denied = await denyAnonymous(request); if (denied) return denied;
  return Response.json(await getLocalGeminiStatus(request), { headers: { "Cache-Control": "no-store" } });
}
