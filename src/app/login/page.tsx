import { redirect } from "next/navigation";
import { BrandMark, PrismSymbol } from "@/components/brand";
import { safeReturnTo } from "@/lib/server/auth-core";
import { FirebaseGoogleLogin } from "@/components/firebase-google-login";
import { currentSiteUser } from "@/lib/server/site-auth";
import "./login.css";

const errors: Record<string, string> = {
  cancelled: "Google 로그인이 취소되었습니다. 준비되면 다시 시도해주세요.",
  expired: "로그인 요청이 만료되었습니다. 아래 버튼으로 다시 시작해주세요.",
  failed: "Google 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  if (await currentSiteUser()) redirect(next);
  const error = params.error ? errors[params.error] || errors.failed : null;
  return <main className="login-page">
    <div className="login-brand" aria-label="Prism"><BrandMark/><span>prism<span>.</span></span></div>
    <section className="login-card" aria-labelledby="login-title">
      <div className="login-symbol"><PrismSymbol/></div>
      <p className="login-eyebrow">A SPACE FOR BETTER THINKING</p>
      <h1 id="login-title">다른 시선이 만나는 곳.</h1>
      <p className="login-description">Google 계정으로 로그인하고<br/>세 AI와 함께 생각을 넓혀보세요.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <FirebaseGoogleLogin next={next}/>
      <p className="login-note">별도 가입 없이 Google 계정으로 시작하세요.</p>
    </section>
  </main>;
}
