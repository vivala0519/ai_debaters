import type { Metadata, Viewport } from "next";
import { PwaSupport } from "@/components/pwa-support";
import { SiteUserProvider } from "@/components/site-user-provider";
import { currentSiteUser } from "@/lib/server/site-auth";
import "./globals.css";
import "./login/login.css";

export const metadata: Metadata = {
  title: "Prism — AI Debate Studio",
  description: "Prism(프리즘) — 하나의 질문, 세 개의 시선. GPT, Claude, Gemini와 함께 더 깊이 생각하는 AI 토론 스튜디오.",
  appleWebApp: { capable: true, title: "Prism", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: true,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentSiteUser();
  return <html lang="ko" data-user-key={user?.storageKey}><body><SiteUserProvider user={user}>{children}<PwaSupport/></SiteUserProvider></body></html>;
}
