# Firebase Google 로그인 설정

실제 Firebase 설정은 Git에서 제외되는 `.env.local`에 저장합니다. 소스의 `src/lib/firebase-settings.ts`는 환경변수만 읽습니다. 값이 없는 `.env.example`만 저장소에 포함합니다. 예전의 `src/lib/firebase-config.ts`와 `firebase-config.local.*` 파일도 Git 제외 대상입니다.

## 로컬 설정

프로젝트 루트 `.env.local`에 Firebase 콘솔의 웹 앱 설정을 아래 변수로 입력합니다. 이미 로컬에 설정되어 있다면 다시 입력할 필요가 없습니다.

```dotenv
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
```

`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID`가 필수입니다. 나머지는 웹 앱 설정에 맞추되 브라우저의 Analytics와 Firestore는 초기화하지 않습니다. 값이 없으면 로그인 버튼을 활성화하지 않고, 서버도 설정되지 않은 프로젝트의 토큰을 수락하지 않습니다. 기기 간 토론 기록 동기화에는 별도의 서버 설정이 필요합니다. [기록 동기화 안내](./history-sync.md)를 참고하세요.

Firebase Authentication에서 Google 제공자를 켜고 지원 이메일을 저장합니다. 승인된 도메인에는 `localhost`와 실제 사용하는 배포 도메인을 등록합니다. `127.0.0.1`로 접속한다면 그것도 별도로 등록합니다. 도메인은 `https://`, 경로, 포트 없이 입력합니다.

## Vercel 배포

1. Vercel 프로젝트의 **Settings → Environment Variables**를 엽니다.
2. `.env.local`의 Firebase 변수와 값을 입력합니다. 사용할 Production·Preview 환경에 맞게 적용합니다.
3. 변경된 코드를 배포합니다. `NEXT_PUBLIC_` 변수는 빌드 시 반영되므로 변수만 바꾸었다면 재배포해야 합니다.
4. `/login`에서 Google 계정으로 로그인해 처음 요청했던 화면으로 돌아오는지 확인합니다. 모바일에서는 배포된 HTTPS 주소를 사용합니다.

로그인만 사용할 때는 Google OAuth 클라이언트 시크릿이나 서비스 계정 JSON이 필요하지 않습니다. 기록 동기화에는 [서버용 Firebase 설정](./history-sync.md)이 추가로 필요합니다. 일반 Vercel 배포에서는 `AUTH_URL`을 비워 둡니다. 별도 프록시를 사용하는 경우 정확한 HTTPS 사이트 주소를 지정할 수 있습니다.

## GitHub 경고와 이전 커밋

`.gitignore`는 새 파일의 추적을 막으며, 이미 커밋된 값이나 이전 커밋을 지우지 않습니다. 파일 삭제 또는 revert로도 이전 커밋에서 값을 조회할 수 있습니다. 공유 저장소의 기록을 다시 쓰고 강제 푸시하는 작업은 다른 사용자의 작업에 영향을 주므로 별도 합의가 필요합니다.

Firebase 웹 설정은 브라우저에 전달되는 공개 식별 정보입니다. `.env.local`로 옮겨도 `NEXT_PUBLIC_` 값은 배포된 브라우저 JavaScript에서 조회할 수 있습니다. 관리자 서비스 계정 키나 AI 제공자 비밀키를 이 변수에 넣으면 안 됩니다. Google Cloud에서 Firebase 웹 키의 API 제한과 앱 제한을 확인하세요. 다른 Google API에도 사용할 수 있는 키가 노출되었거나 키를 교체하기로 했다면 새 키를 로컬·Vercel에 적용하고 로그인 확인 후 이전 키를 폐기하세요. 같은 키를 다른 앱에서도 사용하는지 먼저 확인해야 합니다. GitHub 경고를 숨기는 것으로 키 보호가 완료되지는 않습니다.

## 인증 검증과 기록

서버는 Firebase 토큰의 서명, 프로젝트 발급자·대상, 만료와 인증 시각, 이메일 인증, Google 로그인 제공자를 검증합니다. 비밀번호·익명·다른 제공자로 로그인한 토큰은 거부합니다. 검증된 토큰은 HttpOnly·SameSite=Lax 쿠키에 보관하며 HTTPS에서는 Secure·`__Host-` 접두사를 적용합니다. 쿠키는 토큰 만료까지 최대 1시간이고 Firebase SDK가 토큰과 쿠키를 갱신합니다. 관리 화면에서 사용자를 중지해도 이미 발급한 토큰은 만료까지 유효할 수 있습니다.

서버용 Firebase 설정을 완료하면 토론 기록을 검증된 Firebase UID별로 Firestore에 저장합니다. PC와 모바일에서 같은 Google 계정으로 로그인하면 최근 30개 기록을 함께 볼 수 있습니다. 기존 브라우저 기록도 동기화하며, 연결이 끊기면 로컬 기록을 유지하고 나중에 다시 동기화합니다. 기록 전체 삭제도 다른 기기에 반영됩니다. 자세한 동작과 설정은 [기록 동기화 안내](./history-sync.md)를 참고하세요.

API 키 동기화를 설정하면 API 키를 계정별로 암호화해 서버에 저장하고, 같은 Google 계정으로 로그인한 PC·모바일에서 사용할 수 있습니다. [API 키 동기화 안내](./api-key-sync.md)를 참고하세요. 모델 선택과 연결 방식은 브라우저 세션에 저장합니다. ChatGPT 플랜 연결은 로컬 PC에서만 사용할 수 있으며 API 키 동기화와 별개입니다. 로그아웃하면 Firebase 로그인 상태와 사이트·로컬 ChatGPT 연결 쿠키를 지웁니다.

## 개발 검증

`npm test`는 실제 클라우드 키 없이 API 키 암호화, 계정 분리, 동시 저장, 삭제와 API 접근 제한을 검사합니다. `npm run build`로 빌드를 검사합니다. 빌드 후 `npm run test:http`는 임시 서버에서 잘못된 토큰, CSRF, 비로그인 접근 제한과 PWA를 검사한 뒤 서버를 종료합니다. 실제 로그인 후 토론·기기 간 동기화 검증은 실제 세션이 필요합니다. 세션 쿠키는 Git이나 채팅에 공유하지 마세요.

공식 문서: [Firebase API 키 관리](https://firebase.google.com/docs/projects/api-keys), [Google 로그인](https://firebase.google.com/docs/auth/web/google-signin), [GitHub의 기록 정리 안내](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
