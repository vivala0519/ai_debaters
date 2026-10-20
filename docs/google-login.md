# Firebase Google 로그인

Prism은 Firebase Authentication으로 Google 로그인만 제공합니다. 토론 화면과 API 모두 서버에서 로그인 정보를 검증합니다. Gemini API·Antigravity 연결은 별도입니다.

## 사용자가 마무리할 설정

1. [Firebase Console](https://console.firebase.google.com/project/wallet-test-c7982/authentication/providers)에서 **wallet-test-c7982 → Authentication → 로그인 방법 → Google**을 엽니다. **사용 설정**을 켜고 지원 이메일을 선택한 뒤 저장합니다.
2. **Authentication → 설정 → 승인된 도메인 → 도메인 추가**에서 실제 Vercel 배포 도메인을 추가합니다. `my-app.vercel.app`처럼 **도메인만** 입력합니다. `https://`, 경로, 포트는 넣지 않습니다. 커스텀 도메인으로 접속한다면 그 도메인도 추가합니다. 미리보기 주소가 달라지면 사용하는 주소도 추가해야 합니다.
3. 로컬에서도 로그인하려면 `localhost`를 추가합니다. `127.0.0.1`로 접속한다면 그것도 별도로 추가합니다. 모바일에서는 HTTPS Vercel 주소로 접속합니다.
4. 변경된 코드를 Vercel에 배포한 후 `/login`에서 **Google로 로그인**을 눌러 계정을 선택합니다. 팝업이 차단되면 해당 사이트의 팝업을 허용합니다. 카카오톡 등의 앱 내부 브라우저에서는 Chrome 또는 Safari로 열어 사용합니다.

제공받은 Firebase 웹 앱 설정은 `src/lib/firebase-config.ts`에 반영했습니다. Vercel에 `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, 서비스 계정 JSON을 추가할 필요가 없습니다. 이전 Google OAuth 설정은 사용하지 않습니다. `AUTH_URL`은 기본적으로 비워 둡니다. 기존 값이 남아 있다면 삭제하거나 현재 접속할 HTTPS 사이트 주소로 맞추세요. 일반 Vercel 배포에서는 접속 도메인을 자동으로 사용합니다.

Firebase 웹 설정은 브라우저용 공개 식별 정보입니다. 인증을 우회하는 서버 비밀키가 아닙니다. Analytics와 Firestore는 이 변경으로 초기화하거나 사용하지 않습니다.

## 동작 확인

- 로그인 전 `/settings`에 들어가면 로그인 화면으로 이동합니다.
- Google 계정을 선택하면 처음 열려던 화면으로 돌아옵니다. 비밀번호 로그인이나 다른 소셜 로그인 버튼은 없습니다.
- 왼쪽 메뉴 아래에서 계정과 로그아웃 버튼을 확인합니다.
- `auth/unauthorized-domain` 오류가 나오면 현재 주소의 도메인을 승인된 도메인에 추가합니다. `auth/operation-not-allowed` 오류는 Google 제공자 사용 설정을 확인합니다.

## 세션과 기록

- Firebase ID 토큰의 Google 공개키 서명, 프로젝트 발급자·대상, 만료·인증 시각, 이메일 인증 여부와 Google 로그인 제공자를 검증합니다. 같은 Firebase 프로젝트의 비밀번호·익명·다른 소셜 로그인 토큰도 거부합니다.
- 검증된 ID 토큰을 HttpOnly·SameSite=Lax 쿠키로 보관합니다. HTTPS에서는 Secure·`__Host-` 접두사를 적용합니다. 쿠키 유효기간은 토큰 만료까지 최대 1시간이며, Firebase SDK가 로그인 상태를 유지하고 새 토큰과 서버 쿠키를 갱신합니다. 장시간 닫았다가 열면 로그인 화면을 거쳐 자동 복구될 수 있습니다.
- Firebase 관리 화면에서 계정 사용을 중지해도 이미 발급된 토큰은 만료까지 유효할 수 있습니다. 즉시 세션 차단 정책은 별도로 구현해야 합니다.
- 브라우저 설정과 기록은 Google 계정별로 분리됩니다. 기존 Google 사용자 식별자가 포함된 토큰은 이전 Google 로그인 기록의 저장 키를 유지합니다. 기기 간 기록 동기화는 추가하지 않았습니다.
- 로그아웃하면 Firebase 로그인 상태, 사이트 쿠키와 ChatGPT 연결 쿠키를 지웁니다. 다른 Google 계정으로 로그인할 때 이전 사용자의 ChatGPT 연결을 이어받지 않습니다.
- 기본적으로 인증된 Google 계정은 모두 이용할 수 있습니다. 특정 사용자 허용 정책은 별도입니다.

## 개발 검증

`npm test`로 실제 서버 토큰 검증 구현을 로컬 RSA 서명 토큰으로 검사합니다. `npm run build`로 빌드를 검사합니다. 서버 실행 후 `AGORA_BASE_URL=http://localhost:3010`을 환경변수로 지정하고 `node scripts/auth-smoke.mjs`를 실행하면 잘못된 토큰 거부, CSRF 차단, 로그아웃, 비로그인 접근 제한과 PWA 자산을 검사합니다. 실제 Google 로그인을 모의로 통과시키는 API는 없습니다. 로그인 후 보호된 토론까지 검사하려면 실제 세션 쿠키를 `AGORA_SESSION_COOKIE` 환경변수로 전달합니다. 쿠키를 Git이나 채팅에 공유하지 마세요.

공식 문서: [Firebase Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [Firebase ID 토큰 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens).
