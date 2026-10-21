import type { DebateEvent } from "@/lib/debate";
import { runDebate } from "@/lib/server/debate-engine";
import { getConfiguration, InputError, readRequestJson, resolveSettings, validateDebateRequest } from "@/lib/server/input";
import { getPlanAccessToken, getPlanStatus } from "@/lib/server/chatgpt-auth";
import { getRequestOrigin } from "@/lib/server/request-origin";
import { getLocalGeminiStatus, requireLocalCliRequest } from "@/lib/server/antigravity";
import { requestSiteUser } from "@/lib/server/site-auth";
import { ApiKeyStoreError, readSavedApiKeys } from "@/lib/server/api-key-store";
import { getApiKeyStatus } from "@/lib/api-keys";
import { PROVIDERS } from "@/lib/debate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const unauthenticated = () => Response.json({ error: "Google 계정으로 로그인해주세요.", code: "UNAUTHENTICATED" }, { status: 401, headers });
const accountChanged = () => Response.json({ error: "로그인 계정이 변경되었습니다. 페이지를 새로고침해주세요.", code: "ACCOUNT_CHANGED" }, { status: 409, headers });

export async function GET(request: Request) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get("x-prism-api-key-owner") !== user.id) return accountChanged();
  try {
    const [savedKeys, status, gemini] = await Promise.all([readSavedApiKeys(user.id), getPlanStatus(request).catch(() => null), new URL(request.url).searchParams.get("gemini") === "antigravity" ? getLocalGeminiStatus(request).catch(() => null) : Promise.resolve(null)]);
    const apiKeys = getApiKeyStatus(savedKeys);
    const configuration = getConfiguration();
    if (apiKeys.enabled) {
      configuration.availableProviders = apiKeys.configuredProviders;
      configuration.missingProviders = PROVIDERS.filter(provider => !apiKeys.configuredProviders.includes(provider.id)).map(provider => provider.id);
      configuration.liveAvailable = configuration.missingProviders.length === 0;
    }
    return Response.json({ ...configuration, apiKeys, chatgptConnected: status?.connected ?? false, chatgptAccountId: status?.activeAccountId || null, geminiLocalReady: gemini?.ready ?? false }, { headers });
  } catch {
    return Response.json({ error: "저장된 API 키를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get("x-prism-api-key-owner") !== user.id) return accountChanged();
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== getRequestOrigin(request)) {
      throw new InputError("이 사이트에서 토론을 시작해 주세요.", 403);
    }
    const input = validateDebateRequest(await readRequestJson(request));
    // The verified account's vault is authoritative. A deleted key must never fall
    // back to another account's browser cache or a shared environment credential.
    const savedKeys = input.mode === "live" ? await readSavedApiKeys(user.id) : null;
    if (savedKeys !== null) input.credentials = savedKeys;
    const planToken = input.mode === "live" && input.gptAuthMode === "chatgpt" ? await getPlanAccessToken(request, input.gptAccountId) : undefined;
    const useLocal = input.mode === "live" && input.geminiAuthMode === "antigravity";
    if (useLocal) requireLocalCliRequest(request);
    // Resolve/validate all three credentials before opening a successful stream.
    const settings = resolveSettings(input, planToken, useLocal, savedKeys === null);
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
    return new Response(stream, { headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) {
    const known = error instanceof InputError || error instanceof ApiKeyStoreError;
    return Response.json({ error: known ? error.message : "요청을 처리하지 못했습니다." }, { status: known ? error.status : 500, headers });
  }
}
