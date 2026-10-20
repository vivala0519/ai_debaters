import { createHash, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ChatGptStatus, ChatGptModel } from "../chatgpt";
import { InputError } from "./input";
import { getRequestOrigin } from "./request-origin";
import { hashSession, isLocalPlanRequest, randomOpaque, readSessionId, SESSION_SECONDS, withPlanStore, type PlanAccount } from "./chatgpt-store";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function requireLocalPlan(request: Request) {
  if (!isLocalPlanRequest(request)) throw new InputError("ChatGPT 플랜 연결은 현재 로컬 실행에서 지원합니다. 배포 환경에서는 API 키를 사용해주세요.", 403);
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== getRequestOrigin(request)) throw new InputError("이 사이트의 설정에서 다시 시도해주세요.", 403);
}

let discovery: Promise<{ jwks_uri: string; revocation_endpoint: string }> | undefined;
let jwks: JWTVerifyGetKey | undefined;
async function getDiscovery() {
  if (!discovery) discovery = (async () => {
    const response = await fetch(`${ISSUER}/.well-known/openid-configuration`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Discovery failed");
    const data = await response.json();
    if (data.issuer !== ISSUER) throw new Error("Invalid issuer");
    for (const field of ["jwks_uri", "revocation_endpoint"]) {
      if (typeof data[field] !== "string" || new URL(data[field]).origin !== ISSUER) throw new Error("Invalid discovery endpoint");
    }
    return { jwks_uri: data.jwks_uri as string, revocation_endpoint: data.revocation_endpoint as string };
  })().catch(error => { discovery = undefined; throw error; });
  return discovery;
}

export async function validateIdentity(idToken: string, clientId: string, nonce?: string, expectedSubject?: string, keyResolver?: JWTVerifyGetKey) {
  if (!keyResolver) {
    const metadata = await getDiscovery();
    jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri), { timeoutDuration: 10_000 });
    keyResolver = jwks;
  }
  const { payload } = await jwtVerify(idToken, keyResolver, { issuer: ISSUER, audience: clientId, algorithms: ["RS256", "ES256"], clockTolerance: 5, requiredClaims: ["sub", "exp", "iat"] });
  if (typeof payload.sub !== "string" || !payload.sub || (nonce !== undefined && (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, nonce)))) throw new Error("Invalid identity");
  if (expectedSubject && payload.sub !== expectedSubject) throw new Error("Account identity changed");
  return { subject: payload.sub, email: typeof payload.email === "string" ? payload.email : "ChatGPT 계정" };
}

export function parseTokenResponse(data: unknown) {
  const value = data as Record<string, unknown>;
  if (!value || typeof value.access_token !== "string" || !/^[\x21-\x7e]+$/.test(value.access_token) || value.access_token.length > 32_768 || value.token_type !== "Bearer" || typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) || value.expires_in <= 0 || typeof value.scope !== "string") throw new Error("Invalid tokens");
  const scopes = value.scope.split(/\s+/).filter(Boolean);
  if (!scopes.includes(PLAN_SCOPE) || !scopes.includes("resource.invoke")) throw new InputError("ChatGPT 플랜 사용 권한이 승인되지 않았습니다. 다시 연결하며 플랜 사용을 허용해주세요.", 403);
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
    idToken: typeof value.id_token === "string" ? value.id_token : undefined,
    expiresAt: Date.now() + Math.min(value.expires_in, 86_400) * 1000,
    earliestRefreshAt: typeof value.earliest_refresh_at === "number" ? value.earliest_refresh_at * 1000 : undefined,
    scopes,
  };
}

async function exchange(form: URLSearchParams) {
  const response = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) { await response.body?.cancel(); throw new InputError("ChatGPT 인증을 갱신하지 못했습니다. 설정에서 다시 연결해주세요.", response.status >= 500 ? 502 : response.status === 429 ? 429 : 401); }
  return parseTokenResponse(await response.json());
}

export async function startPlanLogin(request: Request, accountId?: string) {
  requireLocalPlan(request);
  requireSameOrigin(request);
  const sessionId = readSessionId(request) || randomOpaque();
  const sessionHash = hashSession(sessionId);
  return withPlanStore(store => {
    const session = store.sessions[sessionHash] ??= { accounts: [], activeAccountId: null, expiresAt: Date.now() + SESSION_SECONDS * 1000 };
    const account = accountId ? session.accounts.find(item => item.id === accountId) : undefined;
    if (accountId && !account) throw new InputError("연결할 계정을 찾지 못했습니다.");
    const origin = getRequestOrigin(request);
    const redirect = new URL("/api/auth/chatgpt/callback", origin);
    redirect.hostname = "127.0.0.1";
    const state = randomOpaque();
    const nonce = randomOpaque();
    const verifier = randomOpaque();
    // A fresh attempt supersedes old attempts from this browser session.
    for (const [id, pending] of Object.entries(store.pending)) if (pending.sessionHash === sessionHash) delete store.pending[id];
    store.pending[state] = { sessionHash, origin, redirectUri: redirect.href, verifier, nonce, accountId: account?.id, clientId: account?.clientId, expiresAt: Date.now() + 10 * 60_000 };
    session.expiresAt = Date.now() + SESSION_SECONDS * 1000;
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: account?.clientId || "dynamic_agent_client", ext_agent_host_id: store.hostId, response_type: "code", redirect_uri: redirect.href, scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
    if (!account) url.searchParams.set("agent_name_hint", "Prism AI Debate Studio");
    if (account?.idToken) url.searchParams.set("id_token_hint", account.idToken);
    if (account?.email) url.searchParams.set("login_hint", account.email);
    return { sessionId, url: url.href };
  });
}

export async function handlePlanCallback(request: Request): Promise<string> {
  requireLocalPlan(request);
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) throw new InputError("로그인 상태를 확인하지 못했습니다.");
  const pending = await withPlanStore(store => {
    const pending = store.pending[state];
    if (!pending || pending.expiresAt <= Date.now() || `${getRequestOrigin(request)}${url.pathname}` !== pending.redirectUri) throw new InputError("로그인 요청이 만료되었거나 올바르지 않습니다.");
    delete store.pending[state]; // Consume once, before the code exchange.
    return pending;
  });
  const failed = (reason: string) => `${pending.origin}/settings?chatgpt_error=${reason}`;
  if (url.searchParams.has("error")) return failed("denied");
  const code = url.searchParams.get("code");
  const issuedClient = url.searchParams.get("client_id") || pending.clientId;
  if (!code || code.length > 4096 || !issuedClient || issuedClient === "dynamic_agent_client" || !/^[A-Za-z0-9_-]{3,256}$/.test(issuedClient) || (pending.clientId && issuedClient !== pending.clientId)) return failed("invalid");
  try {
    const tokens = await exchange(new URLSearchParams({ grant_type: "authorization_code", client_id: issuedClient, code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE }));
    if (!tokens.idToken) throw new Error("Missing ID token");
    const identity = await validateIdentity(tokens.idToken, issuedClient, pending.nonce);
    const ticket = randomOpaque();
    await withPlanStore(store => {
      const session = store.sessions[pending.sessionHash];
      if (!session) throw new Error("Missing browser session");
      const prior = pending.accountId ? session.accounts.find(item => item.id === pending.accountId) : undefined;
      if (pending.accountId && (!prior || prior.subject !== identity.subject || prior.clientId !== issuedClient)) throw new Error("Account identity changed");
      const account: PlanAccount = { id: prior?.id || randomOpaque(), clientId: issuedClient, ...identity, ...tokens, acknowledged: prior?.acknowledged ?? false };
      // Stage credentials until the original browser proves possession of its
      // HttpOnly cookie. This binds 127.0.0.1 callbacks to localhost safely.
      store.completions[ticket] = { sessionHash: pending.sessionHash, account, expiresAt: Date.now() + 2 * 60_000 };
    });
    return `${pending.origin}/api/auth/chatgpt/finish?ticket=${ticket}`;
  } catch (error) { return failed(error instanceof InputError && error.status === 403 ? "permission" : "invalid"); }
}

export async function finishPlanLogin(request: Request): Promise<boolean> {
  requireLocalPlan(request);
  const sessionId = readSessionId(request);
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  if (!sessionId || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return false;
  return withPlanStore(store => {
    const completion = store.completions[ticket];
    if (!completion || completion.expiresAt <= Date.now() || completion.sessionHash !== hashSession(sessionId)) return false;
    const session = store.sessions[completion.sessionHash];
    if (!session) return false;
    session.accounts = [...session.accounts.filter(account => account.id !== completion.account.id), completion.account];
    session.activeAccountId = completion.account.id;
    delete store.completions[ticket];
    return true;
  });
}

export async function getPlanStatus(request: Request): Promise<ChatGptStatus> {
  const empty: ChatGptStatus = { enabled: isLocalPlanRequest(request), connected: false, activeAccountId: null, accounts: [], welcomeRequired: false };
  if (!empty.enabled) return { ...empty, message: "ChatGPT 플랜 연결은 로컬 실행에서 지원합니다. Vercel 배포에서는 별도 승인된 연동이 필요합니다." };
  const sessionId = readSessionId(request);
  if (!sessionId) return empty;
  return withPlanStore(store => {
    const session = store.sessions[hashSession(sessionId)];
    if (!session) return empty;
    const active = session.accounts.find(account => account.id === session.activeAccountId);
    const connected = (account: PlanAccount) => !!account.accessToken && account.scopes.includes(PLAN_SCOPE) && (account.expiresAt > Date.now() || !!account.refreshToken);
    return { ...empty, connected: !!active && connected(active), activeAccountId: session.activeAccountId, welcomeRequired: !!active && connected(active) && !active.acknowledged, accounts: session.accounts.map(account => ({ id: account.id, label: `${account.email} · ${account.id.slice(-5)}`, connected: connected(account) })) };
  });
}

export async function getPlanAccessToken(request: Request, expectedAccountId?: string): Promise<string> {
  requireLocalPlan(request);
  const sessionId = readSessionId(request);
  if (!sessionId) throw new InputError("설정에서 ChatGPT 계정을 연결해주세요.", 401);
  const result = await withPlanStore(async store => {
    const session = store.sessions[hashSession(sessionId)];
    if (expectedAccountId && expectedAccountId !== session?.activeAccountId) return { error: true as const, accountChanged: true as const };
    const account = session?.accounts.find(item => item.id === session.activeAccountId);
    if (!account?.accessToken || !account.scopes.includes(PLAN_SCOPE)) return { error: true as const };
    if (account.expiresAt > Date.now() + 60_000) return { token: account.accessToken };
    if (account.earliestRefreshAt && account.earliestRefreshAt > Date.now() && account.expiresAt > Date.now()) return { token: account.accessToken };
    if (!account.refreshToken) return { error: true as const };
    try {
      const tokens = await exchange(new URLSearchParams({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: account.refreshToken, resource: RESOURCE }));
      if (!tokens.refreshToken) throw new Error("Missing rotating refresh token");
      if (tokens.idToken) await validateIdentity(tokens.idToken, account.clientId, undefined, account.subject);
      Object.assign(account, { ...tokens, idToken: tokens.idToken || account.idToken });
      return { token: account.accessToken! };
    } catch (error) {
      if (error instanceof InputError && (error.status === 401 || error.status === 403)) {
        delete account.accessToken; delete account.refreshToken; delete account.idToken;
        account.expiresAt = 0;
        return { error: true as const };
      }
      return { error: true as const, temporary: true as const };
    }
  });
  if (result.accountChanged) throw new InputError("다른 탭에서 ChatGPT 계정이 변경되었습니다. 페이지를 새로고침한 후 다시 시도해주세요.", 409);
  if (result.error || !result.token) throw new InputError(result.temporary ? "ChatGPT 인증 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." : "ChatGPT 로그인이 만료되었습니다. 설정에서 다시 연결해주세요.", result.temporary ? 502 : 401);
  return result.token;
}

export async function listPlanModels(request: Request): Promise<ChatGptModel[]> {
  const token = await getPlanAccessToken(request, new URL(request.url).searchParams.get("accountId") || undefined);
  const response = await fetch(`${RESOURCE}/models`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { await response.body?.cancel(); throw new InputError("ChatGPT 모델 목록을 불러오지 못했습니다. 다시 연결하거나 잠시 후 새로고침해주세요.", 502); }
  const data = await response.json();
  if (!Array.isArray(data.models)) throw new InputError("ChatGPT 모델 목록 형식이 올바르지 않습니다.", 502);
  return data.models.filter((model: Record<string, unknown>) => model && model.visibility === "list" && typeof model.slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model.slug) && typeof model.display_name === "string").slice(0, 200).map((model: { slug: string; display_name: string }) => ({ id: model.slug, label: model.display_name.slice(0, 120) }));
}

export async function updatePlanAccount(request: Request, action: "select" | "acknowledge" | "disconnect", accountId?: string) {
  requireLocalPlan(request); requireSameOrigin(request);
  const sessionId = readSessionId(request);
  if (!sessionId) throw new InputError("연결된 ChatGPT 계정이 없습니다.", 401);
  return withPlanStore(async store => {
    const session = store.sessions[hashSession(sessionId)];
    const account = session?.accounts.find(item => item.id === (accountId || session.activeAccountId));
    if (!account) throw new InputError("선택한 계정을 찾지 못했습니다.", 404);
    if (action === "select") { session.activeAccountId = account.id; return { ok: true, revocationConfirmed: true }; }
    if (action === "acknowledge") { account.acknowledged = true; return { ok: true, revocationConfirmed: true }; }
    let revoked = !account.refreshToken;
    if (account.refreshToken) {
      for (let attempt = 0; attempt < 2 && !revoked; attempt++) {
        try {
          const metadata = await getDiscovery();
          const response = await fetch(metadata.revocation_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: account.refreshToken, token_type_hint: "refresh_token", client_id: account.clientId }), redirect: "error", signal: AbortSignal.timeout(8_000) });
          revoked = response.status === 200;
          await response.body?.cancel();
        } catch { /* Retry with the refresh token still available, without logging. */ }
        if (!revoked && attempt === 0) await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    delete account.accessToken; delete account.refreshToken; delete account.idToken;
    account.expiresAt = 0;
    // Prevent an already-open OAuth callback from reconnecting after sign-out.
    for (const [id, pending] of Object.entries(store.pending)) if (pending.sessionHash === hashSession(sessionId)) delete store.pending[id];
    for (const [id, completion] of Object.entries(store.completions)) if (completion.sessionHash === hashSession(sessionId)) delete store.completions[id];
    return { ok: true, revocationConfirmed: revoked };
  });
}
