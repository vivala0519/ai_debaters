"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { getFirebaseAuth, syncFirebaseSession } from "@/lib/firebase-client";
import { firebaseConfigured } from "@/lib/firebase-settings";

function loginError(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code === "auth/unauthorized-domain") return "현재 사이트 주소가 승인되지 않았습니다. Firebase의 승인된 도메인에 이 도메인을 추가해주세요.";
  if (code === "auth/operation-not-allowed") return "Firebase Authentication에서 Google 로그인을 사용 설정해주세요.";
  if (code === "auth/popup-blocked") return "로그인 창이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러주세요.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "로그인이 취소되었습니다. 준비되면 다시 시도해주세요.";
  if (code === "auth/network-request-failed") return "연결을 확인한 뒤 다시 시도해주세요.";
  if (code === "auth/operation-not-supported-in-this-environment" || code === "auth/web-storage-unsupported") return "Safari 또는 Chrome에서 이 사이트를 열고 다시 로그인해주세요.";
  if (code === "auth/invalid-api-key" || code === "auth/app-not-authorized") return "Firebase 웹 앱 설정을 확인해주세요.";
  return "Google 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export function FirebaseGoogleLogin({ next }: { next: string }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const finishing = useRef(false);

  async function finish(user: User) {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true);
    try {
      await syncFirebaseSession(user);
      if (active.current) window.location.replace(next);
    } catch (err) {
      if (active.current) { setError(err instanceof Error ? err.message : loginError(err)); setBusy(false); }
    } finally { finishing.current = false; }
  }

  useEffect(() => {
    active.current = true;
    if (!firebaseConfigured()) {
      setError("Firebase 로그인 설정이 필요합니다. 관리자에게 문의해주세요.");
      return () => { active.current = false; };
    }
    try {
      const unsubscribe = onAuthStateChanged(getFirebaseAuth(), user => {
        setReady(true);
        if (user) void finish(user);
      }, () => { setReady(true); setError("로그인을 준비하지 못했습니다. 새로고침 후 다시 시도해주세요."); });
      return () => { active.current = false; unsubscribe(); };
    } catch (err) { setReady(true); setError(loginError(err)); }
    return () => { active.current = false; };
    // A successful login uses a full navigation, preserving the original destination.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  async function signIn() {
    setError(""); setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const result = await signInWithPopup(getFirebaseAuth(), provider);
      await finish(result.user);
    } catch (err) { if (active.current) { setError(loginError(err)); setBusy(false); } }
  }

  return <>
    {error && <p className="login-error" role="alert">{error}</p>}
    <button className="google-signin" type="button" aria-label="Google로 로그인" onClick={() => { void signIn(); }} disabled={!ready || busy} aria-busy={busy}>
      <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.28-3.13.78-4.59l-7.98-6.19A23.6 23.6 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
      <span>{!ready ? "로그인 준비 중…" : busy ? "로그인 연결 중…" : "Google로 로그인"}</span>
    </button>
  </>;
}
