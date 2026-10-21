# 토론 기록 동기화

같은 Google 계정으로 로그인한 기기에서 최근 30개 토론 기록을 함께 볼 수 있습니다. 기록 저장·삭제에는 Firebase Google 로그인과 같은 프로젝트의 Firestore를 사용합니다.

## 로컬 PC에서 배포 사이트와 동기화

배포 사이트에서 기록 동기화가 작동한다면 로컬에 관리자 비밀키를 복사할 필요가 없습니다. Git에서 제외된 `.env.local`에 본인 Prism 배포 사이트의 HTTPS 주소를 추가하고 로컬 서버를 재시작합니다.

```dotenv
PRISM_HISTORY_SYNC_ORIGIN=https://your-project.vercel.app
```

로컬과 배포 사이트는 같은 Firebase 프로젝트를 사용해야 합니다. 로컬에서 Google 로그인한 사용자의 Firebase 세션으로 배포 사이트의 기록 API에 읽기·저장·삭제를 요청합니다. 로컬의 기존 브라우저 기록도 다음 갱신 때 함께 동기화합니다. 이 주소에는 로그인 세션과 토론 기록이 전달되므로 본인이 운영하는 신뢰할 수 있는 사이트만 지정합니다. 다른 쿠키나 API 키, 플랜 인증은 전달하지 않습니다.

이 연결은 `localhost`, `127.0.0.1`, `[::1]`에서만 사용하고 Vercel에서는 비활성화합니다. 로컬에 Firebase 관리자 설정이 있으면 직접 저장 방식을 우선합니다. 일부만 설정한 관리자 값이 있다면 설정을 완성하거나 제거한 뒤 연결합니다. 배포 사이트의 기록 저장 설정이 없거나 네트워크가 끊기면 로컬 기록은 그대로 유지됩니다.

## 서버에서 Firestore에 직접 연결

서버에 `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`를 설정하고 Firestore 데이터베이스를 생성합니다. 서비스 계정에 해당 프로젝트의 Firestore 읽기·쓰기 권한이 있어야 합니다. 브라우저 설정과 서버 프로젝트가 다르면 저장을 거부합니다. 신뢰할 수 있는 Google 실행 환경에서는 서비스 계정 키 대신 `FIREBASE_ADMIN_USE_APPLICATION_DEFAULT=true`를 사용할 수 있습니다. Vercel은 환경변수 설정 후 재배포가 필요합니다.

`firestore.rules`와 `firestore.indexes.json`을 사용할 프로젝트에 적용합니다. 브라우저는 Firestore에 직접 접근하지 않으며 로그인 세션을 검증한 서버가 UID별 기록을 저장합니다. 설정 방법은 [API 키 동기화 안내](./api-key-sync.md)의 서버 설정도 참고할 수 있습니다. 기록만 사용할 때는 API 키 암호화 변수가 필요하지 않습니다.

기존 브라우저 기록을 동기화하고 네트워크 오류가 나면 로컬 기록을 유지합니다. 화면 복귀·연결 복구·주기적 갱신 때 다시 동기화합니다. 기록 전체 삭제는 다른 기기에도 전파합니다. 기록에는 API 키나 플랜 인증 정보를 포함하지 않습니다. API 키 동기화는 별도의 기능입니다.
