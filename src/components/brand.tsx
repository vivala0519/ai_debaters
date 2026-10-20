import { Orbit, Sparkles, Sun } from "lucide-react";

export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M7 24 14 7h4l7 17h-6l-3-9-3 9H7Z" fill="currentColor"/><circle cx="25" cy="8" r="3" fill="currentColor" opacity=".5"/></svg></span>;
}

export function ProviderMark({ id, small = false }: { id: string; small?: boolean }) {
  return <span className={`provider-mark ${id} ${small ? "small" : ""}`} aria-hidden="true">{id === "gpt" ? <Orbit /> : id === "claude" ? <Sun /> : <Sparkles />}</span>;
}
