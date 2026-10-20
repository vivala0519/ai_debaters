"use client";

import { LogOut } from "lucide-react";
import { useSiteUser } from "./site-user-provider";
import { settingsStorageKey } from "@/lib/client-store";
import { useState } from "react";
import { logoutFirebase } from "@/lib/firebase-client";

export function UserMenu() {
  const user = useSiteUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;
  return <div className="site-account">
    <span className="site-account-avatar" aria-hidden="true">{user.name.slice(0, 1)}</span>
    <div className="site-account-info"><strong>{user.name}</strong><span title={user.email}>{user.email}</span></div>
    <button type="button" className="icon-button" aria-label="로그아웃" title="로그아웃" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        await logoutFirebase();
        try { sessionStorage.removeItem(settingsStorageKey()); } catch { /* Browser storage may be unavailable. */ }
        window.location.replace("/login");
      } catch { setError("로그아웃하지 못했습니다. 다시 시도해주세요."); setBusy(false); }
    }}><LogOut size={17}/></button>
    {error && <span className="site-account-error" role="alert">{error}</span>}
  </div>;
}
