"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteUser } from "@/components/site-user-provider";
import { historyStorageKey, readHistory, readHistoryMetadata, writeHistory } from "./client-store";
import { createHistorySync, type HistorySync, type HistorySyncState } from "./history-sync";
import type { SavedDebate } from "./history";

const empty: HistorySyncState = { history: [], enabled: null, syncing: false, clearing: false, error: null };

export function useDebateHistory(active = true) {
  const user = useSiteUser();
  const sync = useRef<HistorySync | null>(null);
  const [state, setState] = useState<HistorySyncState>(empty);
  useEffect(() => {
    if (!active || !user) return;
    const controller = new AbortController();
    const storageKey = historyStorageKey();
    const instance = createHistorySync({
      read: readHistory,
      readMetadata: readHistoryMetadata,
      write: (history, metadata) => {
        if (historyStorageKey() !== storageKey) throw new Error("Google 계정이 변경되었습니다.");
        writeHistory(history, metadata);
      },
      request: init => fetch("/api/history", { ...init, headers: { ...init?.headers, "X-Prism-History-Owner": user.id }, credentials: "same-origin", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) }),
    });
    sync.current = instance;
    const unsubscribe = instance.subscribe(setState);
    const refresh = () => { if (document.visibilityState !== "hidden") void instance.refresh().catch(() => {}); };
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey) refresh(); };
    refresh();
    const interval = setInterval(refresh, 120_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort(); unsubscribe(); instance.dispose();
      if (sync.current === instance) sync.current = null;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [active, user?.id]);
  return {
    ...state,
    refresh: () => sync.current?.refresh() ?? Promise.resolve(),
    save: (debate: SavedDebate) => sync.current?.save(debate) ?? Promise.reject(new Error("기록 저장을 준비하는 중입니다.")),
    clear: () => sync.current?.clear() ?? Promise.reject(new Error("기록 저장을 준비하는 중입니다.")),
  };
}
