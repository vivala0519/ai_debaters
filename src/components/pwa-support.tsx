"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, ChevronDown, Smartphone, WifiOff } from "lucide-react";
import { completionNotificationsEnabled, registerPwa, setCompletionNotifications, supportsCompletionNotifications } from "@/lib/pwa";
import "./pwa-support.css";
import { useSiteUser } from "./site-user-provider";

export function PwaSupport() {
  const user = useSiteUser();
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateDisplay = () => setStandalone(displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const updateConnection = () => setOnline(navigator.onLine);
    const updateSetting = () => setEnabled(completionNotificationsEnabled());
    updateDisplay(); updateConnection(); updateSetting();
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setSupported(supportsCompletionNotifications());
    setReady(true);
    void registerPwa();
    displayMode.addEventListener("change", updateDisplay);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("storage", updateSetting);
    window.addEventListener("focus", updateSetting);
    return () => {
      displayMode.removeEventListener("change", updateDisplay);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("storage", updateSetting);
      window.removeEventListener("focus", updateSetting);
    };
  }, []);

  async function toggleNotifications() {
    setBusy(true);
    const result = await setCompletionNotifications(!enabled);
    setEnabled(completionNotificationsEnabled());
    setNotice({
      enabled: "완료 알림을 켰습니다. 앱이 열린 동안 수신한 토론 완료를 알려드려요.",
      disabled: "완료 알림을 껐습니다.",
      denied: "알림이 허용되지 않았습니다. 브라우저의 사이트 설정에서 알림을 허용할 수 있어요.",
      unsupported: "이 브라우저에서는 완료 알림을 지원하지 않습니다.",
      unavailable: "알림을 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
    }[result]);
    setBusy(false);
  }

  if (!ready) return null;

  return <>
    {!online && <div className="pwa-connection" role="status"><WifiOff size={16} aria-hidden="true"/><span>오프라인 상태입니다. 토론에는 인터넷 연결이 필요해요.</span></div>}
    <aside className="pwa-support" aria-label="모바일 설치와 완료 알림">
      {!standalone && <details className="pwa-install">
        <summary><Smartphone size={16} aria-hidden="true"/><span>홈 화면에 추가</span><ChevronDown size={14} aria-hidden="true"/></summary>
        <p>{ios ? "iPhone·iPad에서는 Safari로 이 페이지를 열고 공유 버튼 → ‘홈 화면에 추가’를 눌러주세요." : "Android에서는 브라우저 메뉴(⋮) → ‘앱 설치’ 또는 ‘홈 화면에 추가’를 눌러주세요."}</p>
        <p>설치하려면 HTTPS로 연결해야 합니다. 브라우저에 따라 메뉴 이름이 다를 수 있어요.</p>
      </details>}
      {user && supported ? <div className="pwa-notifications">
        <button type="button" onClick={() => { void toggleNotifications(); }} disabled={busy} aria-pressed={enabled}>
          {enabled ? <BellOff size={16} aria-hidden="true"/> : <Bell size={16} aria-hidden="true"/>}
          {busy ? "알림 준비 중…" : enabled ? "완료 알림 끄기" : "완료 알림 켜기"}
        </button>
        <p>앱이 열린 동안 수신한 완료를 알려드려요.</p>
      </div> : ios && !standalone ? <p className="pwa-notification-help">완료 알림은 홈 화면에 추가한 앱에서 사용할 수 있어요.</p> : null}
      {notice && <p className="pwa-notice" role="status">{notice}</p>}
    </aside>
  </>;
}
