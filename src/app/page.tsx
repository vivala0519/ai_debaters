"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, Copy, FlaskConical, History, Layers3, Lightbulb, LoaderCircle, Menu, MessageSquare, MessageSquareText, RotateCcw, Settings2, Shuffle, Sparkles, Square, Trash2, X } from "lucide-react";
import { Sidebar } from "@/components/sidebar";
import { PrismSymbol, ProviderMark } from "@/components/brand";
import { PROVIDERS, type DebateEvent, type DebateMessage, type DebateMode, type DebateRound, type ProviderId } from "@/lib/debate";
import { debateMarkdown, readSettings, type SavedDebate } from "@/lib/client-store";
import { notifyDebateComplete } from "@/lib/pwa";
import { useDebateHistory } from "@/lib/use-debate-history";

const EXAMPLES = [
  { category: "기술과 미래", topic: "AI는 인간의 창의성을 대체할 수 있을까?", position: "AI는 기존의 정보를 조합하는 데 뛰어나지만, 인간의 경험과 감정에서 나오는 창의성을 완전히 대체하기는 어렵다고 생각합니다." },
  { category: "일과 삶", topic: "주 4일 근무제, 지금 도입해야 할까?", position: "근무 시간보다 몰입과 성과가 중요합니다. 주 4일 근무제가 생산성과 삶의 질을 함께 높일 수 있다고 생각합니다." },
  { category: "사회와 가치", topic: "기본소득은 더 나은 사회를 만들 수 있을까?", position: "자동화 시대에는 누구나 최소한의 경제적 안정을 보장받아야 하며, 기본소득은 이를 위한 현실적인 대안이라고 생각합니다." },
  { category: "교육", topic: "학교에서 AI 활용을 적극 허용해야 할까?", position: "AI를 금지하기보다 비판적으로 활용하는 방법을 가르치는 것이 학생들의 미래 역량에 도움이 된다고 생각합니다." },
];
const ROUND_INFO = [
  { id: 1 as DebateRound, title: "독립 입론", en: "INDEPENDENT VIEWS", description: "같은 주제, 서로 다른 출발점", detail: "세 AI가 서로의 의견을 보지 않고\n독립적인 관점을 제시합니다.", icon: Lightbulb },
  { id: 2 as DebateRound, title: "상호 반박", en: "CROSS DEBATE", description: "생각이 부딪히며 깊어지는 순간", detail: "다른 두 AI의 입론을 읽고\n논리의 빈틈과 새로운 쟁점을 찾습니다.", icon: MessageSquareText },
  { id: 3 as DebateRound, title: "최종 입장", en: "REFINED PERSPECTIVES", description: "반박을 넘어, 더 단단한 생각으로", detail: "반박에 답하며 자신의 관점을\n다듬고 최종 입장을 정리합니다.", icon: CheckCheck },
];
const PREVIEW = [
  { id: "gpt", tag: "가능성에 주목", title: "창의성의 대체보다, 확장에 가깝습니다.", content: "AI는 새로운 조합과 아이디어를 빠르게 제안합니다. 하지만 무엇이 의미 있는지 판단하고 방향을 정하는 일에는 여전히 인간의 맥락이 필요합니다." },
  { id: "claude", tag: "본질을 되묻기", title: "결과물이 같아도, 창작의 의미는 다릅니다.", content: "창의성에는 결과물뿐 아니라 그것을 만든 경험과 의도가 담깁니다. AI가 표현을 재현하는 것과 인간의 창의성을 대체하는 것은 구분해야 합니다." },
  { id: "gemini", tag: "관점 넓히기", title: "‘대체할 수 있는가’라는 질문부터 바꿔볼까요?", content: "분야와 과업에 따라 답이 달라집니다. 반복적인 제작은 자동화되겠지만, 인간과 AI의 협업이 새로운 형태의 창의성을 만들 수도 있습니다." },
];

export default function StudioPage() {
  const [topic, setTopic] = useState("");
  const [position, setPosition] = useState("");
  const [mode, setMode] = useState<DebateMode>("live");
  const [mobileMenu, setMobileMenu] = useState(false);
  const historySync = useDebateHistory();
  const history = historySync.history;
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [activeRound, setActiveRound] = useState<DebateRound>(1);
  const [currentRound, setCurrentRound] = useState<DebateRound>(1);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SavedDebate | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [liveReady, setLiveReady] = useState(false);
  const [usesChatGptPlan, setUsesChatGptPlan] = useState(false);
  const [usesGeminiLocal, setUsesGeminiLocal] = useState(false);
  const [chatgptAccountId, setChatgptAccountId] = useState<string | undefined>();
  const [availableProviders, setAvailableProviders] = useState<ProviderId[]>([]);
  const [completedRounds, setCompletedRounds] = useState<number[]>([]);
  const [exampleOffset, setExampleOffset] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDialogElement>(null);
  const openedHistoryLink = useRef(false);

  useEffect(() => {
    const settings = readSettings();
    const usePlan = settings?.gptAuthMode === "chatgpt";
    const useLocal = settings?.geminiAuthMode === "antigravity";
    setUsesGeminiLocal(useLocal);
    setUsesChatGptPlan(usePlan);
    const enteredIds = PROVIDERS.filter(p => !(p.id === "gpt" && usePlan) && !(p.id === "gemini" && useLocal) && !!settings?.credentials[p.id]?.trim()).map(p => p.id);
    fetch(useLocal ? "/api/debate?gemini=antigravity" : "/api/debate").then(r => r.json()).then(data => {
      setChatgptAccountId(data.chatgptAccountId || undefined);
      let available: ProviderId[] = [...new Set<ProviderId>([...(data.availableProviders || []), ...enteredIds])];
      if (usePlan) { available = available.filter(id => id !== "gpt"); if (data.chatgptConnected) available.push("gpt"); }
      if (useLocal) { available = available.filter(id => id !== "gemini"); if (data.geminiLocalReady) available.push("gemini"); }
      setAvailableProviders(available);
      setLiveReady(PROVIDERS.every(p => available.includes(p.id)));
    }).catch(() => { setAvailableProviders(enteredIds); setLiveReady(enteredIds.length === 3); });
    if (new URLSearchParams(window.location.search).get("history") === "1") historyRef.current?.showModal();
    return () => controllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (openedHistoryLink.current || running) return;
    const id = new URLSearchParams(window.location.search).get("debate");
    const selected = history.find(debate => debate.id === id);
    if (selected) { openedHistoryLink.current = true; selectDebate(selected); }
  }, [history, running]);

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 3300); return () => clearTimeout(id); }, [toast]);

  function notify(message: string) { setToast(message); }
  function newDebate() {
    if (running) return notify("진행 중인 토론을 먼저 중지해주세요.");
    setTopic(""); setPosition(""); setMode("live"); setMessages([]); setResult(null); setError(""); setCompletedRounds([]); setActiveRound(1); setCurrentRound(1); setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function selectDebate(debate: SavedDebate) {
    if (running) return notify("진행 중인 토론을 먼저 중지해주세요.");
    setTopic(debate.topic); setPosition(debate.position); setMode(debate.mode); setMessages(debate.messages); setResult(debate); setError("");
    const rounds = ROUND_INFO.filter(r => PROVIDERS.every(p => debate.messages.some(m => m.round === r.id && m.providerId === p.id))).map(r => r.id);
    setCompletedRounds(rounds); const last = (Math.max(1, ...debate.messages.map(m => m.round))) as DebateRound;
    setActiveRound(last); setCurrentRound(last); historyRef.current?.close(); setMobileMenu(false);
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }
  function fillExample(index: number) {
    if (running) return;
    const example = EXAMPLES[index % EXAMPLES.length]; setTopic(example.topic); setPosition(example.position); setError("");
  }

  async function startDebate(override?: typeof EXAMPLES[number]) {
    if (controllerRef.current) return;
    if (historySync.clearing) { notify("기록 삭제가 끝난 뒤 시작해주세요."); return; }
    const inputTopic = (override?.topic ?? topic).trim(); const inputPosition = (override?.position ?? position).trim();
    if (!inputTopic) { setError("토론 주제를 입력해주세요."); return; }
    const selectedMode = override ? "demo" : mode;
    if (selectedMode === "live" && !liveReady) { setError("설정에서 GPT·Claude·Gemini 연결 설정을 마친 후 시작해주세요."); return; }
    if (override) { setTopic(inputTopic); setPosition(inputPosition); setMode("demo"); }
    setMessages([]); setResult(null); setError(""); setRunning(true); setActiveRound(1); setCurrentRound(1); setCompletedRounds([]);
    const controller = new AbortController(); controllerRef.current = controller;
    let debateId = crypto.randomUUID() as string; const collected: DebateMessage[] = []; let status: SavedDebate["status"] = "error"; let receivedComplete = false;
    const createdAt = new Date().toISOString();
    setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    function onEvent(event: DebateEvent) {
      if (event.type === "start") debateId = event.debateId;
      if (event.type === "round-start") { setCurrentRound(event.round); setActiveRound(event.round); }
      if (event.type === "message") { collected.push(event.message); setMessages([...collected]); }
      if (event.type === "round-complete") setCompletedRounds(prev => [...prev, event.round]);
      if (event.type === "complete") { receivedComplete = true; status = event.hasErrors ? "error" : "complete"; }
      if (event.type === "error") throw new Error(event.message);
    }
    try {
      const settings = readSettings();
      const response = await fetch("/api/debate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: inputTopic, position: inputPosition, mode: selectedMode, ...(selectedMode === "live" ? { credentials: settings ? { ...settings.credentials, ...(settings.gptAuthMode === "chatgpt" ? { gpt: "" } : {}), ...(settings.geminiAuthMode === "antigravity" ? { gemini: "" } : {}) } : undefined, models: settings?.models, gptAuthMode: settings?.gptAuthMode, geminiAuthMode: settings?.geminiAuthMode, gptAccountId: settings?.gptAuthMode === "chatgpt" ? chatgptAccountId : undefined } : {}) }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || "토론 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요."); }
      if (!response.body) throw new Error("응답 스트림을 열 수 없습니다.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) onEvent(JSON.parse(buffer));
      if (!receivedComplete) throw new Error("연결이 일찍 종료되었습니다. 수신한 발언은 기록에 저장됩니다.");
      if (status === "error") setError("일부 AI가 응답하지 못했습니다. 각 카드의 안내를 확인하고 다시 시도해주세요.");
    } catch (err) {
      if (controller.signal.aborted) { status = "stopped"; notify("토론을 중지했습니다. 수신한 발언은 기록에 남습니다."); }
      else setError(err instanceof Error ? err.message : "토론 중 오류가 발생했습니다.");
    } finally {
      controllerRef.current = null; setRunning(false);
      const debate: SavedDebate = { id: debateId, topic: inputTopic, position: inputPosition, mode: selectedMode, createdAt, messages: collected, status };
      setResult(debate);
      if (collected.length) {
        void historySync.save(debate).catch(() => notify("기록 동기화를 완료하지 못했습니다. 기록 창에서 상태를 확인해주세요."));
      }
      if (receivedComplete && debate.status === "complete") void notifyDebateComplete(inputTopic, debateId);
    }
  }

  async function copyAll() {
    if (!result) return;
    try { await navigator.clipboard.writeText(debateMarkdown(result)); notify("토론 내용을 복사했습니다."); } catch { notify("복사 권한이 없습니다. 내보내기를 이용해주세요."); }
  }
  function exportDebate() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([debateMarkdown(result)], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `prism-${result.topic.replace(/[<>:"/\\|?*]/g, "").slice(0, 55)}.md`; a.click(); URL.revokeObjectURL(url); notify("Markdown 파일을 내보냈습니다.");
  }
  const hasResults = running || !!result;

  return <div className="app-shell">
    <Sidebar history={history} onNew={newDebate} onHistory={() => { setMobileMenu(false); historyRef.current?.showModal(); void historySync.refresh().catch(() => {}); }} onSelect={selectDebate} open={mobileMenu} onClose={() => setMobileMenu(false)}/>
    <main className="main-shell" inert={mobileMenu || undefined}>
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileMenu(true)} aria-label="메뉴 열기" aria-expanded={mobileMenu} aria-controls="main-sidebar"><Menu size={20}/></button><MessageSquare size={16}/><strong>토론 스튜디오</strong></div><div className="topbar-right"><Link className="icon-button" href="/settings" title="설정" aria-label="설정"><Settings2 size={18}/></Link></div></header>
      <div className="page-inner">
        <section className="hero"><div><div className="eyebrow"><span/>A SPACE FOR BETTER THINKING</div><h1>AI의 <span>시선</span></h1><p>서로 다른 AI의 생각이 만나, 당신의 관점이 더 깊어집니다.</p></div><div className="hero-symbol" aria-hidden="true"><PrismSymbol className="hero-prism"/></div></section>
        <div className="setup-grid">
          <form className="composer-card" onSubmit={e => { e.preventDefault(); void startDebate(); }}>
            <div className="card-heading"><span className="heading-icon"><MessageSquareText size={18}/></span><span className="input-step">01 / START</span></div>
            <div className="topic-field"><label htmlFor="topic">토론 주제 <span>*</span></label><input id="topic" placeholder="" value={topic} onChange={e => setTopic(e.target.value)} maxLength={180} disabled={running} required autoComplete="off"/></div>
            <div className="position-field"><div className="field-label-row"><label htmlFor="position">나의 입론 (선택)</label></div><textarea id="position" placeholder="" value={position} onChange={e => setPosition(e.target.value)} maxLength={4000} disabled={running}/><span className="char-count">{position.length.toLocaleString()} / 4,000</span></div>
            <div className="composer-footer">{running ? <button className="stop-button" type="button" onClick={() => controllerRef.current?.abort()}><Square size={13}/>토론 중지</button> : <button className="primary-button" type="submit">토론 시작하기<ArrowUpRight size={17}/></button>}</div>
          </form>
          <aside className="participants-card"><div className="panel-heading"><h2>토론 패널</h2><span>3 PARTICIPANTS</span></div><div className="provider-list">{PROVIDERS.map(provider => <div className="provider-row" key={provider.id}><ProviderMark id={provider.id}/><div className="provider-info"><strong>{provider.name}<span>{provider.company}</span></strong><p>{{ gpt: "논리적 분석과 균형 잡힌 시각", claude: "깊이 있는 사고와 섬세한 해석", gemini: "다각적 탐색과 새로운 연결" }[provider.id]}</p></div><span className="participant-status" title={mode === "demo" ? "데모 패널" : availableProviders.includes(provider.id) ? "연결 설정됨" : "연결 설정 필요"}><span/></span></div>)}</div><div className="panel-note"><span className="note-stars"><Sparkles size={17}/></span></div></aside>
        </div>
        {mode === "live" && !liveReady && <div className="inline-notice"><Settings2 size={16}/><span>실제 토론을 시작하려면 GPT·Claude·Gemini 연결 설정이 필요합니다.</span><Link href="/settings">설정하러 가기<ArrowUpRight size={13}/></Link></div>}
        {error && <div className="error-notice" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError("")} aria-label="오류 닫기"><X size={16}/></button></div>}
        {(usesChatGptPlan || usesGeminiLocal) && mode === "live" && <div className="inline-notice"><Check size={15}/><span>GPT: {usesChatGptPlan ? "ChatGPT 플랜" : "API"} · Claude: API · Gemini: {usesGeminiLocal ? "로컬 Antigravity 플랜" : "API"} 사용량이 적용됩니다.</span><Link href="/settings">연결 관리<ArrowUpRight size={13}/></Link></div>}
        <section className="flow-section"><div className="section-heading"><div><h2>생각이 깊어지는 3개의 라운드<span className="subtle-dot">.</span></h2></div><span className="flow-count"><Layers3 size={14}/>3 rounds<span>·</span>9 perspectives</span></div><div className="round-flow">{ROUND_INFO.map((round, i) => <div key={round.id} className={`round-step ${hasResults && currentRound === round.id ? "current" : ""}`}><div className="round-step-top"><span className="round-number">0{round.id}</span><span className="round-en">{round.en}</span><round.icon size={20}/></div><h3>{round.title}</h3><p>{round.detail}</p>{i < 2 && <span className="step-connector"><ChevronRight size={15}/></span>}</div>)}</div></section>
        <section className="results-section" ref={resultRef}>
          <div className="section-heading">
            <div>
              <div className="result-title-row"><h2>{"생각이 오가는 현장"}<span
                  className="subtle-dot">.</span></h2><span
                  className={`small-badge ${running ? "is-running" : ""}`}>{running ? <><span className="pulse-dot"/>토론
                진행
                중</> : result ? result.status === "complete" ? "토론 완료" : result.status === "stopped" ? "중지됨" : "일부 응답 실패" : " "}</span>
              </div>
            </div>
            {hasResults && <div className="result-actions">
              <button className="icon-button" onClick={copyAll} disabled={running || !messages.length} title="전체 복사"
                      aria-label="토론 전체 복사"><Copy size={16}/></button>
              <button className="secondary-button export-button" onClick={exportDebate}
                      disabled={running || !messages.length}><ArrowDownToLine size={15}/>내보내기
              </button>
            </div>}</div>
          {hasResults ? <>
            <div className="debate-topic-strip"><span
                className="quote-symbol">“</span><strong>{result?.topic ?? topic}</strong><span
                className="small-badge">{result?.mode === "live" || (running && mode === "live") ? "LIVE AI" : "DEMO"}</span>
            </div>
            <div className="round-tabs" role="tablist" aria-label="토론 라운드">{ROUND_INFO.map(round => <button
                id={`round-tab-${round.id}`} key={round.id} role="tab" aria-selected={activeRound === round.id}
                aria-controls="round-panel" className={activeRound === round.id ? "active" : ""}
                onClick={() => setActiveRound(round.id)}
                disabled={round.id > currentRound && !completedRounds.includes(round.id)}>
              <span>{completedRounds.includes(round.id) ?
                  <Check size={12}/> : `0${round.id}`}</span>{round.title}{running && currentRound === round.id &&
                <LoaderCircle size={12} className="spin"/>}</button>)}</div>
            <div id="round-panel" role="tabpanel" aria-labelledby={`round-tab-${activeRound}`}
                 className="opinion-grid">{PROVIDERS.map(provider => {
              const message = messages.find(m => m.providerId === provider.id && m.round === activeRound);
              return <article className={`opinion-card ${provider.id}`} key={provider.id}>
                <div className="opinion-header"><ProviderMark id={provider.id}
                                                              small/><strong>{provider.name}</strong><span>{message ? message.status === "error" ? "응답 오류" : "발언 완료" : running && activeRound === currentRound ? "생각하는 중" : "대기 중"}</span>
                </div>
                {message ? <div className={`markdown-content ${message.status === "error" ? "failed-message" : ""}`}>
                      <ReactMarkdown>{message.content || message.error || "응답을 받지 못했습니다."}</ReactMarkdown></div> :
                    <div className="thinking-state">{running && activeRound === currentRound ? <>
                      <div className="thinking-dots"><i/><i/><i/></div>
                      <strong>{ROUND_INFO[activeRound - 1].description}</strong><p>{provider.name}가 의견을 준비하고
                      있습니다.</p></> : <><MessageSquareText size={25}/><p>이 라운드의 발언을 기다리고 있습니다.</p></>}</div>}
                <div className="opinion-footer"><span className={`provider-color-dot ${provider.id}`}/>{activeRound}라운드
                  · {ROUND_INFO[activeRound - 1].title}{message?.status === "complete" &&
                      <button className="icon-button" aria-label={`${provider.name} 발언 복사`} title="발언 복사"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(message.content);
                                  notify("발언을 복사했습니다.");
                                } catch {
                                  notify("복사하지 못했습니다.");
                                }
                              }}><Copy size={13}/></button>}</div>
              </article>;
            })}</div>
            {result && <div className="completion-note"><CheckCheck
                size={17}/><span>{result.status === "complete" ? "서로 다른 관점이 당신의 다음 생각으로 이어지길 바랍니다." : "수신한 발언을 확인하거나 같은 주제로 토론을 다시 시작할 수 있습니다."}</span>
              <button className="text-button" onClick={() => void startDebate()}><RotateCcw size={13}/>다시 토론하기</button>
            </div>}</> : <>
          </>}
        </section>
        <footer className="page-footer"><span>서로 다른 생각이 만나는 곳, <strong>prism.</strong></span><span>Powered by curiosity<span className="footer-star">✳</span></span></footer>
      </div>
    </main>
    <dialog ref={historyRef} className="history-dialog" aria-labelledby="history-title">
      <div className="dialog-header"><div><span className="eyebrow">YOUR PERSPECTIVES</span><h2 id="history-title">나의 토론 기록</h2></div><button className="icon-button" onClick={() => historyRef.current?.close()} aria-label="기록 닫기"><X size={20}/></button></div>
      <p className="dialog-description">{historySync.enabled ? "같은 Google 계정으로 로그인한 기기에서 최근 30개의 토론을 이어 볼 수 있습니다." : historySync.enabled === false ? "이 브라우저에 최근 30개의 토론이 저장됩니다." : "최근 토론과 계정 동기화 상태를 확인하고 있습니다."}</p>
      <div className={`history-sync-status ${historySync.error ? "is-error" : ""}`} role="status" aria-live="polite">
        <span>{historySync.error || (historySync.clearing ? "계정의 기록을 삭제하고 있습니다." : historySync.syncing ? "기록을 동기화하고 있습니다." : historySync.enabled ? "계정에 기록을 동기화했습니다." : "기기에 기록을 보관합니다.")}</span>
        <button type="button" className="text-button" disabled={historySync.syncing || historySync.clearing} onClick={() => void historySync.refresh().catch(() => {})}><RotateCcw size={13}/>{historySync.error ? "다시 시도" : "새로고침"}</button>
      </div>
      <div className="history-items">{history.length ? history.map(debate => <button className="history-entry" key={debate.id} onClick={() => selectDebate(debate)}><span className="history-entry-icon"><MessageSquareText size={19}/></span><div><strong>{debate.topic}</strong><span>{new Date(debate.createdAt).toLocaleDateString("ko-KR")} · {debate.mode === "demo" ? "데모" : "실제 AI"} · {debate.messages.length}개의 발언</span></div><ChevronRight size={17}/></button>) : <div className="empty-history"><History size={32}/><h3>아직 토론 기록이 없어요.</h3><p>첫 토론을 시작하면 여기에 모아둘게요.</p></div>}</div>
      {!!history.length && <button className="clear-history" disabled={running || historySync.clearing} onClick={() => {
        void historySync.clear().then(() => notify("모든 토론 기록을 삭제했습니다.")).catch(() => notify("기록을 삭제하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요."));
      }}><Trash2 size={14}/>{historySync.clearing ? "기록 삭제 중" : "모든 기록 삭제"}</button>}
    </dialog>
    {toast && <div className="toast" role="status"><Check size={16}/>{toast}</div>}
  </div>;
}


