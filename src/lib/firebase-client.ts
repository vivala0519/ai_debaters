"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signOut, type User } from "firebase/auth";
import { firebaseConfig, firebaseConfigured } from "./firebase-settings";

export function getFirebaseAuth() {
  if (typeof window === "undefined") throw new Error("Firebase login requires a browser");
  if (!firebaseConfigured()) throw new Error("Firebase 로그인 환경변수가 설정되지 않았습니다. 관리자에게 문의해주세요.");
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  auth.languageCode = "ko";
  return auth;
}

let sessionRequest: { uid: string; promise: Promise<void> } | undefined;
let signingOut = false;
export const isFirebaseSigningOut = () => signingOut;
export function syncFirebaseSession(user: User, forceRefresh = false): Promise<void> {
  if (signingOut) return Promise.reject(new Error("로그아웃 중입니다."));
  if (sessionRequest?.uid === user.uid) return sessionRequest.promise;
  const previous = sessionRequest?.promise;
  const promise = (async () => {
    // Serialize account changes so an earlier request cannot overwrite the new user's cookie.
    await previous?.catch(() => {});
    const idToken = await user.getIdToken(forceRefresh);
    const response = await fetch("/api/auth/firebase/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }), cache: "no-store", credentials: "same-origin",
    });
    if (!response.ok) throw new Error(response.status === 401 ? "Google 계정으로 다시 로그인해주세요." : "로그인 연결을 완료하지 못했습니다. 다시 시도해주세요.");
  })().finally(() => { if (sessionRequest?.promise === promise) sessionRequest = undefined; });
  sessionRequest = { uid: user.uid, promise };
  return promise;
}

export async function logoutFirebase(): Promise<void> {
  signingOut = true;
  try {
    // Let any cookie renewal finish before clearing it, and prevent renewal during logout.
    await sessionRequest?.promise.catch(() => {});
    await signOut(getFirebaseAuth());
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해주세요.");
  } finally { signingOut = false; }
}
