import { requestSiteUser } from "@/lib/server/site-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await requestSiteUser(request);
  return Response.json({ user }, { status: user ? 200 : 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}
