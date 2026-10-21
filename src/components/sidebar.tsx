"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowUpRight, Check, ChevronDown, CircleHelp, History, MessageSquare, Plus, Settings2, X } from "lucide-react";
import { BrandMark, ProviderMark } from "./brand";
import type { SavedDebate } from "@/lib/client-store";
import { useDebateHistory } from "@/lib/use-debate-history";
import { UserMenu } from "./user-menu";

type Props = { current?: "studio" | "settings"; history?: SavedDebate[]; onNew?: () => void; onHistory?: () => void; onSelect?: (debate: SavedDebate) => void; open?: boolean; onClose?: () => void };

export function Sidebar({ current = "studio", history: suppliedHistory, onNew, onHistory, onSelect, open, onClose }: Props) {
  const syncedHistory = useDebateHistory(suppliedHistory === undefined);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const mobile = window.matchMedia("(max-width: 850px)");
    if (!mobile.matches) { closeRef.current?.(); return; }
    const drawer = drawerRef.current;
    if (!drawer) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...drawer.querySelectorAll<HTMLElement>("a[href], button:not(:disabled), [tabindex='0']")]
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const frame = requestAnimationFrame(() => (focusable()[0] ?? drawer).focus({ preventScroll: true }));
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current?.(); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); drawer!.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !drawer!.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer!.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
    const onResize = () => { if (!mobile.matches) closeRef.current?.(); };
    document.addEventListener("keydown", onKeyDown);
    mobile.addEventListener("change", onResize);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      mobile.removeEventListener("change", onResize);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
  const history = suppliedHistory ?? syncedHistory.history;
  return <><div className={`sidebar-scrim ${open ? "visible" : ""}`} onClick={onClose} aria-hidden="true"/><aside id="main-sidebar" ref={drawerRef} className={`sidebar ${open ? "is-open" : ""}`} role={open ? "dialog" : undefined} aria-modal={open || undefined} aria-label="주 메뉴" tabIndex={open ? -1 : undefined}>
    <Link className="brand" href="/" aria-label="Prism 홈"><BrandMark/><span>prism<span className="brand-dot">.</span></span><span className="brand-beta">BETA</span></Link>
    <button className="mobile-close icon-button" aria-label="메뉴 닫기" onClick={onClose}><X size={19}/></button>
    {onNew ? <button className="new-debate" onClick={onNew}><Plus size={17}/>새 토론 시작<span>↗</span></button> : <Link className="new-debate" href="/"><Plus size={17}/>새 토론 시작<span>↗</span></Link>}
    <p className="nav-caption">WORKSPACE</p>
    <nav aria-label="주 메뉴"><Link href="/" className={`nav-item ${current === "studio" ? "active" : ""}`}><MessageSquare size={18}/>토론 스튜디오<span className="nav-active-dot"/></Link>
    {onHistory ? <button className="nav-item" onClick={onHistory}><History size={18}/>토론 기록<span className="nav-count">{history.length}</span></button> : <Link className="nav-item" href="/?history=1"><History size={18}/>토론 기록</Link>}
    </nav>
    <div className="sidebar-line"/>
    <div className="recent-label"><p className="nav-caption">최근 토론</p><span>{history.length > 0 ? history.length.toString().padStart(2, "0") : ""}</span></div>
    <div className="recent-list">{history.length ? history.slice(0, 5).map(debate => <button key={debate.id} className="recent-item" title={debate.topic} onClick={() => onSelect ? onSelect(debate) : window.location.assign(`/?debate=${encodeURIComponent(debate.id)}`)}><span className={`recent-dot ${debate.mode === "live" ? "live" : ""}`}/><span>{debate.topic}</span></button>) : <div className="recent-empty"><MessageSquare size={18}/><span>첫 번째 생각을 남겨보세요.<br/>토론이 여기에 기록됩니다.</span></div>}</div>
    <UserMenu/>
  </aside></>;
}
