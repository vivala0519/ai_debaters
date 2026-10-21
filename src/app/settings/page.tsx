"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Menu, PlugZap, RotateCcw, Save, ShieldCheck, X } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { ProviderMark } from "@/components/brand";
import { readSettings, settingsStorageKey, type ApiSettings } from "@/lib/client-store";
import { PROVIDERS, type ProviderId } from "@/lib/debate";
import { getModelOptions } from "@/lib/model-options";
import type { ConnectionTestRequest, ConnectionTestResponse } from "@/lib/connection-test";
import type { ChatGptStatus, ChatGptModel, GptAuthMode } from "@/lib/chatgpt";
import { ChatGptConnection } from "@/components/chatgpt-connection";
import { GeminiLocalConnection } from "@/components/gemini-local-connection";
import type { LocalGeminiStatus, GeminiAuthMode } from "@/lib/gemini-local";
import "./settings.css";

const KEY_LINKS: Record<ProviderId, string> = {
  gpt: "https://platform.openai.com/api-keys",
  claude: "https://platform.claude.com/settings/keys",
  gemini: "https://aistudio.google.com/app/apikey",
};

function defaultSettings(): ApiSettings {
  return {
    credentials: { gpt: "", claude: "", gemini: "" },
    gptAuthMode: "api-key",
    geminiAuthMode: "api-key",
    models: Object.fromEntries(PROVIDERS.map(provider => [provider.id, provider.model])) as ApiSettings["models"],
  };
}

type TestState =
  | { status: "idle" | "testing" }
  | { status: "success"; model: string; latencyMs: number }
  | { status: "error"; message: string };

function initialTests(): Record<ProviderId, TestState> {
  return { gpt: { status: "idle" }, claude: { status: "idle" }, gemini: { status: "idle" } };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ApiSettings>(defaultSettings);
  const [visible, setVisible] = useState<Record<ProviderId, boolean>>({ gpt: false, claude: false, gemini: false });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [tests, setTests] = useState(initialTests);
  const testControllers = useRef<Partial<Record<ProviderId, AbortController>>>({});
  const [planStatus, setPlanStatus] = useState<ChatGptStatus | null>(null);
  const [planModels, setPlanModels] = useState<ChatGptModel[]>([]);
  const previousPlan = useRef<ChatGptStatus | null>(null);
  const [geminiLocal, setGeminiLocal] = useState<LocalGeminiStatus | null>(null);
  const onGeminiStatus = useCallback((value: LocalGeminiStatus | null) => {
    setGeminiLocal(value);
    testControllers.current.gemini?.abort(); delete testControllers.current.gemini;
    setTests(current => ({ ...current, gemini: { status: "idle" } }));
  }, []);
  const onGeminiMode = useCallback((value: GeminiAuthMode) => {
    testControllers.current.gemini?.abort(); delete testControllers.current.gemini;
    setTests(current => ({ ...current, gemini: { status: "idle" } }));
    setSettings(current => ({ ...current, geminiAuthMode: value, models: { ...current.models, gemini: PROVIDERS.find(provider => provider.id === "gemini")!.model } }));
    setDirty(true); setStatus(null);
  }, []);
  useEffect(() => {
    if (settings.geminiAuthMode !== "antigravity" || !geminiLocal?.models.length || geminiLocal.models.some(model => model.id === settings.models.gemini)) return;
    setSettings(current => ({ ...current, models: { ...current.models, gemini: geminiLocal.models[0].id } }));
    setDirty(true);
  }, [settings.geminiAuthMode, settings.models.gemini, geminiLocal]);

  const onPlanStatus = useCallback((value: ChatGptStatus | null) => {
    if (previousPlan.current?.activeAccountId !== value?.activeAccountId || previousPlan.current?.connected !== value?.connected) {
      testControllers.current.gpt?.abort(); delete testControllers.current.gpt;
      setTests(current => ({ ...current, gpt: { status: "idle" } }));
    }
    previousPlan.current = value;
    setPlanStatus(value);
  }, []);

  const onPlanMode = useCallback((value: GptAuthMode) => {
    testControllers.current.gpt?.abort(); delete testControllers.current.gpt;
    setTests(current => ({ ...current, gpt: { status: "idle" } }));
    setSettings(current => ({ ...current, gptAuthMode: value }));
    setDirty(true); setStatus(null);
  }, []);

  const onPlanModel = useCallback((model: string) => {
    testControllers.current.gpt?.abort(); delete testControllers.current.gpt;
    setTests(current => ({ ...current, gpt: { status: "idle" } }));
    setSettings(current => ({ ...current, models: { ...current.models, gpt: model } }));
    // Keep the valid account-specific default after an OAuth round trip without
    // overwriting other, unsaved form edits.
    const saved = readSettings();
    if (saved?.gptAuthMode === "chatgpt") {
      try { sessionStorage.setItem(settingsStorageKey(), JSON.stringify({ ...saved, models: { ...saved.models, gpt: model } })); }
      catch { /* The normal save button reports storage failures. */ }
    }
    setDirty(true); setStatus(null);
  }, []);

  useEffect(() => {
    const saved = readSettings();
    if (saved) setSettings(saved);
    setReady(true);
    return () => {
      for (const controller of Object.values(testControllers.current)) controller?.abort();
      testControllers.current = {};
    };
  }, []);

  function cancelTest(id: ProviderId) {
    testControllers.current[id]?.abort();
    delete testControllers.current[id];
    setTests(current => ({ ...current, [id]: { status: "idle" } }));
  }

  function updateField(group: "credentials" | "models", id: ProviderId, value: string) {
    cancelTest(id);
    setSettings(current => ({ ...current, [group]: { ...current[group], [id]: value } }));
    setDirty(true);
    setStatus(null);
  }

  async function testConnection(id: ProviderId) {
    if (testControllers.current[id]) return;
    const provider = PROVIDERS.find(item => item.id === id)!;
    const usePlan = id === "gpt" && settings.gptAuthMode === "chatgpt";
    const useLocal = id === "gemini" && settings.geminiAuthMode === "antigravity";
    const apiKey = settings.credentials[id].trim();
    const model = settings.models[id].trim() || provider.model;
    if (!apiKey && !usePlan && !useLocal) {
      setTests(current => ({ ...current, [id]: { status: "error", message: "API 키를 먼저 입력해주세요." } }));
      return;
    }
    const controller = new AbortController();
    testControllers.current[id] = controller;
    setTests(current => ({ ...current, [id]: { status: "testing" } }));
    const timeout = setTimeout(() => controller.abort(new DOMException("Connection test timed out", "TimeoutError")), 35_000);
    try {
      const request: ConnectionTestRequest = { providerId: id, apiKey: usePlan || useLocal ? "" : apiKey, model, ...(usePlan ? { gptAuthMode: "chatgpt", gptAccountId: planStatus?.activeAccountId || undefined } : {}), ...(useLocal ? { geminiAuthMode: "antigravity" } : {}) };
      const response = await fetch("/api/connection-test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request), signal: controller.signal, cache: "no-store",
      });
      const data: ConnectionTestResponse = await response.json();
      if (testControllers.current[id] !== controller) return;
      if (!response.ok || !data.ok) {
        throw new Error(!data.ok && typeof data.error === "string" ? data.error : "연결 테스트에 실패했습니다. 다시 시도해주세요.");
      }
      if (data.providerId !== id || data.model !== model || !Number.isFinite(data.latencyMs) || data.latencyMs < 0) {
        throw new Error("연결 테스트 결과를 확인하지 못했습니다. 다시 시도해주세요.");
      }
      setTests(current => ({ ...current, [id]: { status: "success", model, latencyMs: data.latencyMs } }));
    } catch (error) {
      if (testControllers.current[id] !== controller) return;
      const message = controller.signal.aborted
        ? "응답 시간이 초과되었습니다. 잠시 후 다시 테스트해주세요."
        : error instanceof Error && !(error instanceof SyntaxError) && error.name !== "TypeError"
          ? error.message
          : "연결 테스트 서버에 연결하지 못했습니다. 다시 시도해주세요.";
      setTests(current => ({ ...current, [id]: { status: "error", message } }));
    } finally {
      clearTimeout(timeout);
      if (testControllers.current[id] === controller) delete testControllers.current[id];
    }
  }

  function save(event?: FormEvent<HTMLFormElement>): boolean {
    event?.preventDefault();
    const normalized = defaultSettings();
    normalized.gptAuthMode = settings.gptAuthMode || "api-key";
    normalized.geminiAuthMode = settings.geminiAuthMode || "api-key";
    for (const provider of PROVIDERS) {
      normalized.credentials[provider.id] = settings.credentials[provider.id].trim();
      normalized.models[provider.id] = settings.models[provider.id].trim() || provider.model;
    }
    try {
      sessionStorage.setItem(settingsStorageKey(), JSON.stringify(normalized));
      setSettings(normalized);
      setDirty(false);
      setStatus({ text: "현재 브라우저 세션에 설정을 저장했습니다." });
      return true;
    } catch {
      setStatus({ text: "브라우저가 세션 저장을 허용하지 않습니다. 브라우저 설정을 확인해 주세요.", error: true });
      return false;
    }
  }

  function reset() {
    try {
      sessionStorage.removeItem(settingsStorageKey());
      for (const controller of Object.values(testControllers.current)) controller?.abort();
      testControllers.current = {};
      setTests(initialTests());
      setSettings(defaultSettings());
      setVisible({ gpt: false, claude: false, gemini: false });
      setDirty(false);
      setStatus({ text: "API 키와 모델 설정을 초기화했습니다. ChatGPT 계정은 연결 해제로, Google 계정은 CLI에서 로그아웃할 수 있습니다." });
    } catch {
      setStatus({ text: "저장한 설정을 지우지 못했습니다. 브라우저 설정을 확인해 주세요.", error: true });
    }
  }

  const enteredCount = PROVIDERS.filter(provider => provider.id === "gpt" && settings.gptAuthMode === "chatgpt" ? planStatus?.connected : provider.id === "gemini" && settings.geminiAuthMode === "antigravity" ? geminiLocal?.ready : settings.credentials[provider.id].trim()).length;

  return <div className="app-shell settings-shell">
    <Sidebar current="settings" open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    <main className="main-shell" inert={sidebarOpen || undefined}>
      <header className="topbar settings-topbar">
        <div className="settings-breadcrumb"><button type="button" className="icon-button mobile-menu" aria-label="메뉴 열기" aria-expanded={sidebarOpen} aria-controls="main-sidebar" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><strong>설정</strong></div>
        <Link href="/" className="settings-back-link"><ArrowLeft size={15} />토론 스튜디오</Link>
      </header>
      <div className="page-inner settings-content">
        <div className="settings-heading"><p className="settings-eyebrow">MAKE IT YOURS</p><h1>AI 연결 설정<span>.</span></h1><p>나의 API 키로 세 AI를 초대하고, 더 깊은 토론을 시작하세요.</p></div>

        <div className="settings-overview">
          <div className="settings-overview-icon"><KeyRound size={21} /></div>
          <div><h2>나의 AI 패널</h2><p>각 서비스의 키와 사용할 모델을 설정합니다.</p></div>
          <span className="settings-count"><span />{enteredCount} / 3 설정됨</span>
        </div>

        <p className="settings-test-notice"><PlugZap size={14} /><span>저장 전에도 연결을 테스트할 수 있습니다. 연결 테스트에는 각 연결 방식에 따른 사용량이 발생합니다.</span></p>

        <form onSubmit={save} className="settings-form" aria-label="AI API 설정">
          <div className="settings-provider-list">
            {PROVIDERS.map(provider => {
              const test = tests[provider.id];
              const usePlan = provider.id === "gpt" && settings.gptAuthMode === "chatgpt";
              const useLocal = provider.id === "gemini" && settings.geminiAuthMode === "antigravity";
              const useAccount = usePlan || useLocal;
              const accountReady = usePlan ? planStatus?.connected : geminiLocal?.ready;
              const modelOptions = usePlan ? planModels : useLocal ? geminiLocal?.models || [] : getModelOptions(provider.id, settings.models[provider.id]);
              return <section className="settings-provider-card" key={provider.id} aria-labelledby={`${provider.id}-heading`}>
              <div className="settings-provider-heading"><ProviderMark id={provider.id} /><div><h2 id={`${provider.id}-heading`}>{provider.name}<span>{provider.company}</span></h2><p>{provider.description}</p></div><span className={`settings-key-state ${(useAccount ? accountReady : settings.credentials[provider.id].trim()) ? "is-entered" : ""}`}>{test.status === "success" ? <><CheckCircle2 size={12} />연결 확인</> : useAccount ? accountReady ? usePlan ? "ChatGPT 연결됨" : "CLI 준비됨" : "연결 필요" : settings.credentials[provider.id].trim() ? <><Check size={12} />입력됨</> : "키 미입력"}</span></div>
              {provider.id === "gpt" && <ChatGptConnection mode={settings.gptAuthMode || "api-key"} selectedModel={settings.models.gpt} onModeChange={onPlanMode} onStatusChange={onPlanStatus} onModelsChange={setPlanModels} onModelChange={onPlanModel} onBeforeSignIn={() => save()} />}
              {provider.id === "gemini" && <GeminiLocalConnection mode={settings.geminiAuthMode || "api-key"} onModeChange={onGeminiMode} onStatusChange={onGeminiStatus} />}
              <div className={`settings-fields ${useAccount ? "using-plan" : ""}`}>
                {!useAccount && <div className="settings-field"><div className="settings-label-row"><label htmlFor={`${provider.id}-key`}>API 키</label><a href={KEY_LINKS[provider.id]} target="_blank" rel="noopener noreferrer" aria-label={`${provider.name} 공식 API 키 발급 페이지 (새 탭)`}>키 발급받기<ArrowUpRight size={12} /></a></div>
                  <div className="settings-key-input"><input id={`${provider.id}-key`} type={visible[provider.id] ? "text" : "password"} value={settings.credentials[provider.id]} onChange={event => updateField("credentials", provider.id, event.target.value)} placeholder={`${provider.name} API 키를 입력하세요`} autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={1024} disabled={!ready} aria-describedby={`${provider.id}-key-help`} /><button type="button" aria-label={`${provider.name} API 키 ${visible[provider.id] ? "숨기기" : "표시"}`} aria-pressed={visible[provider.id]} onClick={() => setVisible(current => ({ ...current, [provider.id]: !current[provider.id] }))}>{visible[provider.id] ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
                  <p id={`${provider.id}-key-help`} className="settings-field-help">아래 연결 테스트로 키와 모델 접근 권한을 확인하세요.</p>
                </div>}
                <div className="settings-field">
                  <div className="settings-label-row">
                    <label htmlFor={`${provider.id}-model`}>사용할 모델</label>
                    {!useAccount && <button className="settings-default-button" type="button" onClick={() => updateField("models", provider.id, provider.model)} disabled={!ready || settings.models[provider.id] === provider.model}>기본값</button>}
                  </div>
                  <div className="settings-model-select">
                    <select id={`${provider.id}-model`} value={useAccount && !modelOptions.length ? "" : settings.models[provider.id] || provider.model} onChange={event => updateField("models", provider.id, event.target.value)} disabled={!ready || (useAccount && !modelOptions.length)} aria-describedby={`${provider.id}-model-help`}>
                      {useAccount && !modelOptions.length && <option value="">{useLocal ? "CLI 로그인 후 모델을 불러옵니다" : "ChatGPT 연결 후 모델을 불러옵니다"}</option>}
                      {modelOptions.map(model => <option key={model.id} value={model.id}>{model.label}{!useAccount && model.id === provider.model ? " · 기본" : ""}</option>)}
                    </select>
                    <ChevronDown size={16} aria-hidden="true" />
                  </div>
                  <p id={`${provider.id}-model-help`} className="settings-field-help">{useLocal ? "이 PC의 Antigravity CLI가 제공한 Gemini 모델 목록입니다. 실제 계정 접근 권한은 연결 테스트로 확인하세요." : usePlan ? "연결한 ChatGPT 계정의 모델 목록입니다. 실제 접근 여부는 연결 테스트로 확인하세요." : "사용할 모델을 선택하세요. 접근 권한은 계정에 따라 다릅니다."}</p>
                </div>
              </div>
              <div className="settings-connection-test">
                <div className={`settings-test-result ${test.status}`} role="status" aria-live="polite" aria-atomic="true">
                  {test.status === "idle" && <><PlugZap size={15} /><span>{useLocal ? "이 PC의 CLI 연결 상태를 테스트합니다." : usePlan ? "연결한 ChatGPT 계정과 선택한 모델로 테스트합니다." : "현재 입력한 키와 모델로 테스트합니다."}</span></>}
                  {test.status === "testing" && <><LoaderCircle size={15} className="spin" /><span>모델의 응답을 기다리고 있습니다.</span></>}
                  {test.status === "success" && <><CheckCircle2 size={16} /><div><strong>모델 응답을 확인했습니다.</strong><span>{test.model} · {(test.latencyMs / 1000).toFixed(2)}초</span></div></>}
                  {test.status === "error" && <><AlertCircle size={16} /><span>{test.message}</span></>}
                </div>
                <div className="settings-test-buttons">
                  {test.status === "testing" && <button className="settings-test-cancel" type="button" onClick={() => cancelTest(provider.id)} aria-label={`${provider.name} 연결 테스트 중지`}><X size={13} />중지</button>}
                  <button className="settings-test-button" type="button" onClick={() => void testConnection(provider.id)} disabled={!ready || (useAccount ? !accountReady || !modelOptions.some(model => model.id === settings.models[provider.id]) : !settings.credentials[provider.id].trim()) || test.status === "testing"} aria-label={`${provider.name} 연결 테스트`}>
                    {test.status === "testing" ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />}
                    {test.status === "testing" ? "테스트 중" : test.status === "success" ? "다시 테스트" : "연결 테스트"}
                  </button>
                </div>
              </div>
            </section>;
            })}
          </div>

          <div className="settings-privacy"><ShieldCheck size={19} /><div><h3>API 키는 브라우저 세션에, 구독 인증은 로컬에 보관됩니다.</h3><p>ChatGPT 토큰은 로컬 서버가, Google 로그인은 공식 CLI가 관리합니다. 인증 정보는 토론 기록과 내보내기에 포함되지 않으며 브라우저에 구독 인증 토큰을 전달하지 않습니다.</p></div></div>

          <div className="settings-actions"><button className="button secondary-button settings-reset" type="button" onClick={reset} disabled={!ready}><RotateCcw size={15} />설정 초기화</button><div className="settings-save-group"><span className="settings-unsaved">{dirty ? "저장하지 않은 변경사항이 있습니다." : ""}</span><button className="button primary-button" type="submit" disabled={!ready}><Save size={16} />설정 저장하기</button></div></div>
          <div className={`settings-status ${status?.error ? "is-error" : ""}`} role="status" aria-live="polite">{status && <>{status.error ? <LockKeyhole size={15} /> : <Check size={15} />}{status.text}</>}</div>
        </form>
        <p className="settings-footnote">API 키 연결은 각 서비스의 API 요금이 적용됩니다. ChatGPT 플랜 연결은 로컬 실행에서 사용할 수 있습니다. Antigravity CLI의 외부 앱 연동은 소비자 플랜에서 지원되지 않습니다. <Link href="/">키 없이 데모 체험하기<ArrowUpRight size={12} /></Link></p>
      </div>
    </main>
  </div>;
}
