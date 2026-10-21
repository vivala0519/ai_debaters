import { HISTORY_REQUEST_BYTES, HistoryInputError } from "@/lib/history";
import { appendHistory, clearHistory, getHistory, HistoryConflictError } from "@/lib/server/history-store";
import { requestSiteUser, siteOrigin } from "@/lib/server/site-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };

function historyResponse(value: unknown) {
  // Long debates can exceed Vercel's buffered response size limit in aggregate.
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) { controller.close(); return; }
      const end = Math.min(offset + 65_536, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  }), { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "X-Accel-Buffering": "no" } });
}
const unauthenticated = () => Response.json({ error: "Google 계정으로 로그인해주세요.", code: "UNAUTHENTICATED" }, { status: 401, headers });
const accountChanged = () => Response.json({ error: "로그인 계정이 변경되었습니다. 페이지를 새로고침해주세요.", code: "ACCOUNT_CHANGED" }, { status: 409, headers });

function failure(error: unknown) {
  return error instanceof HistoryInputError || error instanceof HistoryConflictError
    ? Response.json({ error: error.message }, { status: error.status, headers })
    : Response.json({ error: "토론 기록을 동기화하지 못했습니다. 서버 설정과 연결을 확인해주세요." }, { status: 503, headers });
}

async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new HistoryInputError("application/json 형식으로 요청해주세요.", 415);
  if (!request.body) throw new HistoryInputError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > HISTORY_REQUEST_BYTES) {
        await reader.cancel();
        throw new HistoryInputError("한 번에 동기화할 기록이 너무 큽니다.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof HistoryInputError) throw error;
    throw new HistoryInputError("올바른 JSON 형식으로 요청해주세요.");
  } finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get("x-prism-history-owner") !== user.id) return accountChanged();
  try { return historyResponse(await getHistory(user.id)); }
  catch (error) { return failure(error); }
}

async function mutate(request: Request, clear: boolean) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get("x-prism-history-owner") !== user.id) return accountChanged();
  try {
    if (request.headers.get("origin") !== siteOrigin(request)) return Response.json({ error: "이 사이트에서 토론 기록을 변경해주세요." }, { status: 403, headers });
    const input = await readJson(request);
    return historyResponse(await (clear ? clearHistory(user.id, input) : appendHistory(user.id, input)));
  } catch (error) { return failure(error); }
}

export const POST = (request: Request) => mutate(request, false);
export const DELETE = (request: Request) => mutate(request, true);
