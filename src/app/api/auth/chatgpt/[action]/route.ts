import { finishPlanLogin, getPlanStatus, handlePlanCallback, listPlanModels, requireLocalPlan, startPlanLogin, updatePlanAccount } from "@/lib/server/chatgpt-auth";
import { InputError, readRequestJson } from "@/lib/server/input";
import { sessionCookie } from "@/lib/server/chatgpt-store";
import { getRequestOrigin } from "@/lib/server/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ action: string }> };
const failure = (error: unknown) => Response.json({ error: error instanceof InputError ? error.message : "ChatGPT 연결을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: error instanceof InputError ? error.status : 502, headers });
const redirect = (url: string) => new Response(null, { status: 303, headers: { ...headers, Location: url } });

export async function GET(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    if (action === "status") return Response.json(await getPlanStatus(request), { headers });
    requireLocalPlan(request);
    if (action === "models") return Response.json({ models: await listPlanModels(request) }, { headers });
    if (action === "callback") return redirect(await handlePlanCallback(request));
    if (action === "finish") return redirect(`${getRequestOrigin(request)}/settings?${await finishPlanLogin(request) ? "chatgpt=connected" : "chatgpt_error=session"}`);
    throw new InputError("지원하지 않는 요청입니다.", 404);
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { action } = await context.params;
    const body = await readRequestJson(request) as { accountId?: unknown };
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.accountId !== undefined && (typeof body.accountId !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.accountId)))) throw new InputError("계정 선택 형식이 올바르지 않습니다.");
    const accountId = body.accountId as string | undefined;
    if (action === "start") {
      const result = await startPlanLogin(request, accountId);
      return Response.json({ url: result.url }, { headers: { ...headers, "Set-Cookie": sessionCookie(result.sessionId) } });
    }
    if (action === "select" || action === "acknowledge" || action === "disconnect") return Response.json(await updatePlanAccount(request, action, accountId), { headers });
    throw new InputError("지원하지 않는 요청입니다.", 404);
  } catch (error) { return failure(error); }
}
