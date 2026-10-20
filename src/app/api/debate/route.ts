import type { DebateEvent } from "@/lib/debate";
import { runDebate } from "@/lib/server/debate-engine";
import { getConfiguration, InputError, readRequestJson, resolveSettings, validateDebateRequest } from "@/lib/server/input";
import { getPlanAccessToken, getPlanStatus } from "@/lib/server/chatgpt-auth";
import { getRequestOrigin } from "@/lib/server/request-origin";
import { getLocalGeminiStatus, requireLocalCliRequest } from "@/lib/server/antigravity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(request: Request) {
  const [status, gemini] = await Promise.all([getPlanStatus(request).catch(() => null), new URL(request.url).searchParams.get("gemini") === "antigravity" ? getLocalGeminiStatus(request).catch(() => null) : Promise.resolve(null)]);
  return Response.json({ ...getConfiguration(), chatgptConnected: status?.connected ?? false, chatgptAccountId: status?.activeAccountId || null, geminiLocalReady: gemini?.ready ?? false }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== getRequestOrigin(request)) {
      throw new InputError("이 사이트에서 토론을 시작해 주세요.", 403);
    }
    const input = validateDebateRequest(await readRequestJson(request));
    const planToken = input.mode === "live" && input.gptAuthMode === "chatgpt" ? await getPlanAccessToken(request, input.gptAccountId) : undefined;
    const useLocal = input.mode === "live" && input.geminiAuthMode === "antigravity";
    if (useLocal) requireLocalCliRequest(request);
    // Resolve/validate all three credentials before opening a successful stream.
    const settings = resolveSettings(input, planToken, useLocal);
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const onDisconnect = () => controller.abort();
    request.signal.addEventListener("abort", onDisconnect, { once: true });
    if (request.signal.aborted) controller.abort();
    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async start(output) {
        const emit = (event: DebateEvent) => {
          if (!closed && !controller.signal.aborted) output.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        // Empty NDJSON lines keep idle HTTP connections alive during generation.
        heartbeat = setInterval(() => {
          if (!closed && !controller.signal.aborted) output.enqueue(encoder.encode("\n"));
        }, 15_000);
        try {
          await runDebate(input, emit, controller.signal, settings);
        } catch {
          if (!controller.signal.aborted) emit({ type: "error", message: "토론 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요." });
        } finally {
          clearInterval(heartbeat);
          request.signal.removeEventListener("abort", onDisconnect);
          if (!closed) {
            closed = true;
            output.close();
          }
        }
      },
      cancel() {
        closed = true;
        clearInterval(heartbeat);
        controller.abort();
        request.signal.removeEventListener("abort", onDisconnect);
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Content-Type-Options": "nosniff", "X-Accel-Buffering": "no" } });
  } catch (error) {
    return Response.json({ error: error instanceof InputError ? error.message : "요청을 처리하지 못했습니다." }, { status: error instanceof InputError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
