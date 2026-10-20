import { Orbit, Sparkles, Sun } from "lucide-react";

export function PrismSymbol({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M18 5 6 32h24L18 5Z" fill="var(--accent-soft)"/>
    <path d="M18 5 6 32h12V5Z" fill="currentColor" opacity=".12"/>
    <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="2">
      <path d="M18 5 6 32h24L18 5Z" stroke="currentColor"/>
      <path d="M2 21h9m0 0 13-2" stroke="currentColor" opacity=".55"/>
      <path d="m24 19 14-7" stroke="var(--accent)"/>
      <path d="M26.5 24H38" stroke="var(--prism-violet)"/>
      <path d="m28.5 29 9.5 6" stroke="var(--rose)"/>
    </g>
  </svg>;
}

export function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true"><PrismSymbol/></span>;
}

export function ProviderMark({ id, small = false }: { id: string; small?: boolean }) {
  return <span className={`provider-mark ${id} ${small ? "small" : ""}`} aria-hidden="true">{id === "gpt" ? <Orbit /> : id === "claude" ? <Sun /> : <Sparkles />}</span>;
}
