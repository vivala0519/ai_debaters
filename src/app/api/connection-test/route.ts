import { testProviderConnection, validateConnectionTestRequest } from "@/lib/server/connection-test";
import { InputError, readRequestJson } from "@/lib/server/input";
import { ProviderError } from "@/lib/server/providers";
import { getPlanAccessToken } from "@/lib/server/chatgpt-auth";
import { getRequestOrigin } from "@/lib/server/request-origin";
import { requireLocalCliRequest } from "@/lib/server/antigravity";
import { denyAnonymous } from "@/lib/server/site-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const denied = await denyAnonymous(request); if (denied) return denied;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== getRequestOrigin(request)) {
      throw new InputError("이 사이트의 설정에서 연결을 테스트해 주세요.", 403);
    }
    const input = validateConnectionTestRequest(await readRequestJson(request));
    if (input.providerId === "gpt" && input.gptAuthMode === "chatgpt") input.apiKey = await getPlanAccessToken(request, input.gptAccountId);
    if (input.providerId === "gemini" && input.geminiAuthMode === "antigravity") requireLocalCliRequest(request);
    const result = await testProviderConnection(input, request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    if (request.signal.aborted) {
      return Response.json({ ok: false, error: "연결 테스트가 취소되었습니다." }, { status: 499, headers });
    }
    const known = error instanceof InputError || error instanceof ProviderError;
    return Response.json(
      { ok: false, error: known ? error.message : "연결 테스트를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: known ? error.status : 502, headers },
    );
  }
}
