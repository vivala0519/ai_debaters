"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, LoaderCircle, LogOut, Plus, RefreshCw } from "lucide-react";
import type { ChatGptModel, ChatGptStatus, GptAuthMode } from "@/lib/chatgpt";

type Props = {
  mode: GptAuthMode;
  selectedModel: string;
  onModeChange: (mode: GptAuthMode) => void;
  onStatusChange: (status: ChatGptStatus | null) => void;
  onModelsChange: (models: ChatGptModel[]) => void;
  onModelChange: (model: string) => void;
  onBeforeSignIn: () => boolean | Promise<boolean>;
};

export function ChatGptConnection({ mode, selectedModel, onModeChange, onStatusChange, onModelsChange, onModelChange, onBeforeSignIn }: Props) {
  const [status, setStatus] = useState<ChatGptStatus | null>(null);
  const [models, setModels] = useState<ChatGptModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);

  async function loadStatus(signal?: AbortSignal) {
    const response = await fetch("/api/auth/chatgpt/status", { cache: "no-store", signal });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "ChatGPT 연결 상태를 확인하지 못했습니다.");
    setStatus(value); onStatusChange(value);
    return value as ChatGptStatus;
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadStatus(controller.signal).catch(() => { if (!controller.signal.aborted) { setError("ChatGPT 연결 상태를 확인하지 못했습니다. 페이지를 새로고침해주세요."); onStatusChange(null); } });
    const url = new URL(window.location.href);
    const reason = url.searchParams.get("chatgpt_error");
    if (reason) setError(({ denied: "로그인을 취소했거나 플랜 사용 권한을 허용하지 않았습니다.", permission: "ChatGPT 플랜 사용 권한을 허용하고 다시 연결해주세요.", invalid: "로그인 검증에 실패했거나 만료되었습니다. 다시 연결해주세요.", session: "로그인을 시작한 브라우저 세션을 확인하지 못했습니다. 이 페이지에서 다시 연결해주세요." } as Record<string, string>)[reason] || "ChatGPT 연결에 실패했습니다. 다시 시도해주세요.");
    if (url.searchParams.has("chatgpt") || reason) {
      url.searchParams.delete("chatgpt"); url.searchParams.delete("chatgpt_error");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
    return () => controller.abort();
  }, [onStatusChange]);

  useEffect(() => {
    if (status?.welcomeRequired && mode === "chatgpt" && !dialog.current?.open) dialog.current?.showModal();
  }, [status?.welcomeRequired, mode]);

  useEffect(() => {
    const controller = new AbortController();
    setModels([]); onModelsChange([]);
    if (!status?.connected || mode !== "chatgpt") { setLoadingModels(false); return () => controller.abort(); }
    setLoadingModels(true);
    fetch(`/api/auth/chatgpt/models?accountId=${encodeURIComponent(status.activeAccountId || "")}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.models)) throw new Error(data.error || "모델 목록을 불러오지 못했습니다.");
      if (!controller.signal.aborted) { setModels(data.models); onModelsChange(data.models); if (!data.models.length) setError("이 계정에서 사용할 수 있는 모델이 없습니다."); }
    }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다."); }).finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, [mode, status?.connected, status?.activeAccountId, catalogVersion, onModelsChange]);

  useEffect(() => {
    if (mode === "chatgpt" && models.length && !models.some(model => model.id === selectedModel)) onModelChange((models.find(model => model.id === "gpt-6.1-sol") || models[0]).id);
  }, [mode, models, selectedModel, onModelChange]);

  async function action(name: string, accountId?: string) {
    const response = await fetch(`/api/auth/chatgpt/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(accountId ? { accountId } : {}) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "ChatGPT 연결을 처리하지 못했습니다.");
    return data;
  }

  async function signIn(addAccount = false) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!await onBeforeSignIn()) { setBusy(false); return; }
      const data = await action("start", addAccount ? undefined : status?.activeAccountId || undefined);
      const url = new URL(data.url);
      if (url.origin !== "https://auth.openai.com" || url.pathname !== "/api/accounts/authorize") throw new Error("로그인 주소가 올바르지 않습니다.");
      window.location.assign(url.href);
    } catch (err) { setError(err instanceof Error ? err.message : "로그인을 시작하지 못했습니다."); setBusy(false); }
  }

  async function selectAccount(accountId: string) {
    setBusy(true); setError("");
    setStatus(null);
    onStatusChange(null); onModelsChange([]);
    try { await action("select", accountId); await loadStatus(); }
    catch (err) { setError(err instanceof Error ? err.message : "계정을 전환하지 못했습니다."); await loadStatus().catch(() => {}); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    const accountId = status?.activeAccountId || undefined;
    setBusy(true); setError("");
    setStatus(null);
    onStatusChange(null); onModelsChange([]);
    try {
      const result = await action("disconnect", accountId); await loadStatus();
      if (!result.revocationConfirmed) setError("로컬 연결은 해제했지만 원격 세션 해제를 확인하지 못했습니다. ChatGPT 설정에서 이 앱의 연결을 해제해주세요.");
    } catch (err) { setError(err instanceof Error ? err.message : "연결 해제에 실패했습니다."); await loadStatus().catch(() => {}); }
    finally { setBusy(false); }
  }

  async function acknowledge() {
    try { await action("acknowledge", status?.activeAccountId || undefined); setStatus(current => current ? { ...current, welcomeRequired: false } : current); dialog.current?.close(); }
    catch { setError("안내 확인을 저장하지 못했습니다. 잠시 후 다시 시도해주세요."); dialog.current?.close(); }
  }

  return <div className="chatgpt-connection">
    <div className="chatgpt-auth-tabs" aria-label="GPT 연결 방식">
      <button type="button" aria-pressed={mode === "api-key"} className={mode === "api-key" ? "active" : ""} onClick={() => onModeChange("api-key")}>API 키 사용</button>
      <button type="button" aria-pressed={mode === "chatgpt"} className={mode === "chatgpt" ? "active" : ""} onClick={() => onModeChange("chatgpt")}>ChatGPT 플랜 사용</button>
    </div>
    {mode === "chatgpt" && <div className="chatgpt-plan-panel">
      <div className="chatgpt-plan-heading"><strong>{status?.connected ? <><CheckCircle2 size={14} />ChatGPT 플랜 사용 중</> : "ChatGPT 계정으로 GPT 연결"}</strong><a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">사용량 관리<ArrowUpRight size={12} /></a></div>
      <p>GPT 발언과 연결 테스트가 Codex·ChatGPT Work와 같은 플랜 사용량에 포함됩니다. Claude와 Gemini는 각 서비스의 API 키를 사용합니다.</p>
      {status && !status.enabled ? <div className="chatgpt-plan-error" role="status">{status.message}</div> : <>
        {!!status?.accounts.length && <label className="chatgpt-account-label">ChatGPT 계정<select value={status.activeAccountId || ""} disabled={busy} onChange={event => void selectAccount(event.target.value)}>{status.accounts.map(account => <option key={account.id} value={account.id}>{account.label}{account.connected ? "" : " · 다시 연결 필요"}</option>)}</select></label>}
        <div className="chatgpt-plan-actions">
          <button type="button" className="chatgpt-signin" disabled={busy || !status} onClick={() => void signIn()}>{busy ? <LoaderCircle size={15} className="spin" /> : null}Continue with ChatGPT</button>
          {!!status?.accounts.length && <button type="button" className="text-button" disabled={busy} onClick={() => void signIn(true)}><Plus size={13} />다른 계정 추가</button>}
          {status?.connected && <button type="button" className="text-button" disabled={busy} onClick={() => void disconnect()}><LogOut size={13} />연결 해제</button>}
        </div>
        {status?.connected && <button type="button" className="chatgpt-refresh-models" disabled={loadingModels || busy} onClick={() => { setError(""); setCatalogVersion(version => version + 1); }}><RefreshCw size={12} className={loadingModels ? "spin" : ""} />{loadingModels ? "계정의 모델 목록을 불러오는 중" : "모델 목록 새로고침"}</button>}
        <p className="chatgpt-save-note">로그인 시 현재 입력한 설정을 저장한 뒤 OpenAI 로그인 화면으로 이동합니다.</p>
      </>}
      {error && <div className="chatgpt-plan-error" role="alert">{error}</div>}
    </div>}
    <dialog className="chatgpt-welcome" ref={dialog} aria-labelledby="chatgpt-welcome-title" onCancel={event => { event.preventDefault(); void acknowledge(); }}>
      <CheckCircle2 size={28} /><h2 id="chatgpt-welcome-title">ChatGPT 플랜을 사용합니다.</h2>
      <p>이 앱의 GPT 요청은 Codex·ChatGPT Work와 같은 플랜 사용량 또는 크레딧을 사용합니다. ChatGPT 설정에서 앱별 사용량과 한도를 관리할 수 있습니다.</p>
      <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener noreferrer">사용량 관리<ArrowUpRight size={13} /></a>
      <button type="button" className="primary-button" onClick={() => void acknowledge()}>확인했습니다</button>
    </dialog>
  </div>;
}
