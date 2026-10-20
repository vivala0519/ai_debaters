"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import type { GeminiAuthMode, LocalGeminiStatus } from "@/lib/gemini-local";

export function GeminiLocalConnection({ mode, onModeChange, onStatusChange }: {
  mode: GeminiAuthMode;
  onModeChange: (mode: GeminiAuthMode) => void;
  onStatusChange: (status: LocalGeminiStatus | null) => void;
}) {
  const [status, setStatus] = useState<LocalGeminiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    try {
      const response = await fetch("/api/gemini-local", { cache: "no-store", signal });
      if (!response.ok) throw new Error();
      const data: LocalGeminiStatus = await response.json();
      if (!signal?.aborted) { setStatus(data); onStatusChange(data); }
    } catch {
      if (!signal?.aborted) { setStatus(null); onStatusChange(null); }
    } finally { if (!signal?.aborted) setBusy(false); }
  }, [onStatusChange]);
  useEffect(() => {
    if (mode !== "antigravity") return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [mode, refresh]);

  async function copyCommand() {
    try { await navigator.clipboard.writeText("agy"); setCopied(true); }
    catch { setCopied(false); }
  }

  return <div className="chatgpt-connection">
    <div className="chatgpt-auth-tabs" role="group" aria-label="Gemini 연결 방식">
      <button type="button" className={mode === "api-key" ? "active" : ""} aria-pressed={mode === "api-key"} onClick={() => onModeChange("api-key")}>API 키 사용</button>
      <button type="button" className={mode === "antigravity" ? "active" : ""} aria-pressed={mode === "antigravity"} onClick={() => onModeChange("antigravity")}>로컬 Google 구독 연결</button>
    </div>
    {mode === "antigravity" && <div className="chatgpt-plan-panel gemini-local-panel">
      <div className="chatgpt-plan-heading"><strong><Terminal size={14} />Antigravity CLI로 Gemini 연결</strong><a href="https://www.antigravity.google/docs/plans/" target="_blank" rel="noopener noreferrer">구독별 사용량<ArrowUpRight size={12} /></a></div>
      <p>이 PC의 CLI에 로그인한 Google 계정을 사용합니다. Google AI Pro·Ultra의 Antigravity 한도가 적용되며 Gemini 앱 대화 한도와는 다릅니다. 연결 테스트도 사용량을 소모합니다.</p>
      <p>기본 한도만 사용하려면 CLI의 AI Credit Overages를 Never로 설정하세요. Always이면 한도 소진 후 보유 AI 크레딧을 사용할 수 있습니다.</p>
      <ol className="gemini-local-steps">
        <li><a href="https://www.antigravity.google/docs/getting-started?tab=cli" target="_blank" rel="noopener noreferrer">공식 Antigravity CLI 설치<ArrowUpRight size={11} /></a></li>
        <li>터미널에서 <code>agy</code>를 실행하고 Google 계정으로 로그인하세요. <button type="button" onClick={() => void copyCommand()} aria-label="agy 명령 복사">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "복사됨" : "명령 복사"}</button></li>
        <li>아래에서 상태를 확인하고, 모델 선택 후 연결 테스트를 실행하세요.</li>
      </ol>
      <p className="gemini-local-status" role="status">{busy ? "CLI와 모델 목록을 확인하고 있습니다…" : status?.message || "상태를 확인하지 못했습니다. 다시 확인해주세요."}</p>
      <div className="chatgpt-plan-actions"><button type="button" className="settings-test-button" disabled={busy} onClick={() => void refresh()}>{busy ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}설치·로그인 상태 확인</button></div>
      <p className="chatgpt-save-note">설치 후 인식되지 않으면 개발 서버를 다시 실행하세요. 로그아웃·계정 전환은 CLI에서 진행합니다. 구독 연결은 로컬에서, Vercel 배포는 API 키 방식으로 사용하세요.</p>
    </div>}
  </div>;
}
