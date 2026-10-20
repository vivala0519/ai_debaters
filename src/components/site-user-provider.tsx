"use client";

import { createContext, useContext, useEffect } from "react";
import { onIdTokenChanged } from "firebase/auth";
import { getFirebaseAuth, isFirebaseSigningOut, logoutFirebase, syncFirebaseSession } from "@/lib/firebase-client";
import type { SiteUser } from "@/lib/server/auth-core";

const SiteUserContext = createContext<SiteUser | null>(null);
export function SiteUserProvider({ user, children }: { user: SiteUser | null; children: React.ReactNode }) {
  useEffect(() => {
    if (!user) return;
    let active = true;
    let checking = false;
    let observedFirebaseUser = false;
    const auth = getFirebaseAuth();
    const controller = new AbortController();
    const login = () => window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    async function checkSession() {
      if (checking) return;
      checking = true;
      try {
        if (auth.currentUser) await syncFirebaseSession(auth.currentUser);
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!active) return;
        if (response.status === 401) login();
        else if (response.ok) {
          const data = await response.json();
          if (active && data.user?.id !== user!.id) window.location.reload();
        }
      } catch { /* A temporary network failure does not sign the user out. */ }
      finally { checking = false; }
    }
    const unsubscribe = onIdTokenChanged(auth, firebaseUser => {
      if (firebaseUser) {
        observedFirebaseUser = true;
        void checkSession();
      } else if (observedFirebaseUser && !isFirebaseSigningOut()) {
        // Wait for in-flight cookie renewals before clearing a session signed out in another tab.
        void logoutFirebase().then(() => { if (active) login(); }).catch(() => {});
      }
    });
    // Firebase refreshes the ID token when needed; renew the HttpOnly cookie alongside it.
    const interval = setInterval(() => { if (auth.currentUser) void checkSession(); }, 10 * 60_000);
    window.addEventListener("focus", checkSession);
    window.addEventListener("pageshow", checkSession);
    return () => {
      active = false; controller.abort(); unsubscribe(); clearInterval(interval);
      window.removeEventListener("focus", checkSession); window.removeEventListener("pageshow", checkSession);
    };
  }, [user]);
  return <SiteUserContext.Provider value={user}>{children}</SiteUserContext.Provider>;
}
export const useSiteUser = () => useContext(SiteUserContext);
