"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Check, LoaderCircle, Settings2, X } from "lucide-react";
import { ProviderMark } from "@/components/brand";
import type { DebateMode, ProviderId } from "@/lib/debate";
import "./debate-start-dialog.css";

export interface DebateStartParticipant {
  id: ProviderId;
  name: string;
  connection: string;
  model: string;
  ready: boolean;
}

interface DebateStartDialogProps {
  open: boolean;
  loading: boolean;
  error: string;
  mode: DebateMode;
  topic: string;
  participants: readonly DebateStartParticipant[];
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

export function DebateStartDialog({ open, loading, error, mode, topic, participants, onClose, onConfirm, onRetry }: DebateStartDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const backdropPointerRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const canConfirm = !loading && !error && participants.length === 3 && participants.every(participant => participant.ready);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${parseFloat(window.getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
    }
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      if (dialog.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return <dialog
    ref={dialogRef}
    className="debate-start-dialog"
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClose={() => { if (open && dialogRef.current && !dialogRef.current.open) onClose(); }}
    onPointerDown={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      backdropPointerRef.current = event.target === event.currentTarget
        && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    }}
    onClick={event => {
      if (backdropPointerRef.current && event.target === event.currentTarget) onClose();
      backdropPointerRef.current = false;
    }}
  >
    <div className="debate-start-content">
      <header className="debate-start-heading">
        <div>
          <span className="debate-start-eyebrow">READY TO DISCUSS</span>
          <h2 id={titleId}>토론 시작 전 확인</h2>
        </div>
        <button type="button" className="debate-start-close" onClick={onClose} aria-label="토론 시작 확인 닫기"><X size={20} aria-hidden="true"/></button>
      </header>
      <p id={descriptionId} className="debate-start-description">각 AI의 연결 방식과 사용할 모델을 확인해주세요.</p>
      <div className="debate-start-topic"><span>{mode === "demo" ? "데모 토론" : "실시간 토론"}</span><strong>{topic}</strong></div>

      <div className="debate-start-participants" aria-busy={loading}>
        {participants.map(participant => <section key={participant.id} className="debate-start-participant" aria-label={`${participant.name} 설정`}>
          <div className="debate-start-provider">
            <ProviderMark id={participant.id}/>
            <div className="debate-start-provider-name"><h3>{participant.name}</h3><span className="debate-start-connection">{participant.connection}</span></div>
            <span className={`debate-start-readiness ${!loading && participant.ready ? "is-ready" : ""}`}>
              {loading ? <LoaderCircle className="debate-start-spinner" size={13} aria-hidden="true"/> : participant.ready ? <Check size={13} aria-hidden="true"/> : <AlertCircle size={13} aria-hidden="true"/>}
              {loading ? "확인 중" : participant.ready ? "준비됨" : "설정 필요"}
            </span>
          </div>
          <dl className="debate-start-model"><dt>사용 모델</dt><dd>{participant.model || (loading ? "모델 확인 중" : "모델 미설정")}</dd></dl>
        </section>)}
      </div>

      {loading && <p className="debate-start-status" role="status">최신 연결 설정을 확인하고 있습니다.</p>}
      {error && <div className="debate-start-error" role="alert"><p><AlertCircle size={16} aria-hidden="true"/>{error}</p><button type="button" onClick={onRetry} disabled={loading}>다시 확인</button></div>}
      {!loading && !error && !canConfirm && <p className="debate-start-status">설정이 필요한 AI를 연결한 뒤 다시 확인해주세요.</p>}
      <p className="debate-start-note">{mode === "demo" ? "데모 모드에서는 예시 응답을 사용하며 API나 플랜 사용량이 차감되지 않습니다." : "API 연결은 각 제공자의 API 사용량으로 처리됩니다. 플랜 연결 여부와 사용할 모델을 확인해주세요."}</p>
      <Link href="/settings" onClick={onClose} className="debate-start-settings"><Settings2 size={15} aria-hidden="true"/>연결 및 모델 설정 변경<ArrowRight size={14} aria-hidden="true"/></Link>
    </div>
    <footer className="debate-start-footer">
      <button ref={cancelRef} type="button" className="debate-start-cancel" onClick={onClose} autoFocus>취소</button>
      <button type="button" className="debate-start-confirm" onClick={() => { if (canConfirm) onConfirm(); }} disabled={!canConfirm}>확인하고 토론 시작<ArrowRight size={17} aria-hidden="true"/></button>
    </footer>
  </dialog>;
}
