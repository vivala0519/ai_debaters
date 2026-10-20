import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prism — AI Debate Studio",
  description: "Prism(프리즘) — 하나의 질문, 세 개의 시선. GPT, Claude, Gemini와 함께 더 깊이 생각하는 AI 토론 스튜디오.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
