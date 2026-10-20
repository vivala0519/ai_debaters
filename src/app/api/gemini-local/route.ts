import { getLocalGeminiStatus } from "@/lib/server/antigravity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: Request) {
  return Response.json(await getLocalGeminiStatus(request), { headers: { "Cache-Control": "no-store" } });
}
