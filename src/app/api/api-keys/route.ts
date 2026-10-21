import { API_KEY_OWNER_HEADER, API_KEY_REQUEST_BYTES, ApiKeyInputError, getApiKeyStatus } from "@/lib/api-keys";
import { ApiKeyStoreError, readSavedApiKeys, writeSavedApiKeys } from "@/lib/server/api-key-store";
import { requestSiteUser, siteOrigin } from "@/lib/server/site-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie", "X-Content-Type-Options": "nosniff" };
const unauthenticated = () => Response.json({ error: "Google 계정으로 로그인해주세요.", code: "UNAUTHENTICATED" }, { status: 401, headers });
const accountChanged = () => Response.json({ error: "로그인 계정이 변경되었습니다. 페이지를 새로고침해주세요.", code: "ACCOUNT_CHANGED" }, { status: 409, headers });

function failure(error: unknown) {
  const safeError = error instanceof ApiKeyInputError || error instanceof ApiKeyStoreError ? error : new ApiKeyStoreError();
  return Response.json({ error: safeError.message }, { status: safeError.status, headers });
}

async function readPatch(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ApiKeyInputError("application/json 형식으로 요청해주세요.", 415);
  if (!request.body) throw new ApiKeyInputError();
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > API_KEY_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiKeyInputError("API 키 설정 요청이 너무 큽니다.", 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const input: unknown = JSON.parse(body);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || !("credentials" in input)) throw new ApiKeyInputError();
    return input.credentials;
  } catch (error) {
    if (error instanceof ApiKeyInputError) throw error;
    throw new ApiKeyInputError("올바른 JSON 형식으로 요청해주세요.");
  } finally { reader.releaseLock(); }
}

export async function GET(request: Request) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get(API_KEY_OWNER_HEADER) !== user.id) return accountChanged();
  try { return Response.json(getApiKeyStatus(await readSavedApiKeys(user.id)), { headers }); }
  catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  const user = await requestSiteUser(request);
  if (!user) return unauthenticated();
  if (request.headers.get(API_KEY_OWNER_HEADER) !== user.id) return accountChanged();
  try {
    if (request.headers.get("origin") !== siteOrigin(request)) return Response.json({ error: "이 사이트에서 API 키를 변경해주세요." }, { status: 403, headers });
    return Response.json(await writeSavedApiKeys(user.id, await readPatch(request)), { headers });
  } catch (error) { return failure(error); }
}
