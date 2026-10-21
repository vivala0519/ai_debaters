# 계정별 API 키 동기화

설정에서 API 키를 저장하면 같은 Google 계정으로 로그인한 PC와 모바일에서 사용할 수 있습니다. Vercel의 서버 함수와 Firebase Firestore를 사용하므로 별도의 PC나 VM을 계속 켜둘 필요가 없습니다. API 호출 요금은 각 제공자의 API 계정에 적용됩니다. ChatGPT Plus/Pro 인증과 로컬 Antigravity 인증은 이 기능으로 동기화하지 않습니다.

## 서버 설정

Firebase Google 로그인과 같은 프로젝트에서 Firestore 데이터베이스를 생성합니다. 서버에 다음 환경변수를 설정합니다. Vercel에서는 사용할 Production·Preview 환경별로 설정한 뒤 코드를 재배포합니다.

```dotenv
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=
PRISM_API_KEYS_ENCRYPTION_KEY=
```

이미 기록 동기화용 관리자 설정이 있다면 그대로 사용합니다. `FIREBASE_ADMIN_PRIVATE_KEY`는 서비스 계정 PEM 키이며 `\n` 이스케이프를 허용합니다. 브라우저의 `NEXT_PUBLIC_FIREBASE_PROJECT_ID`와 서버 프로젝트가 같아야 합니다. 신뢰할 수 있는 Google 실행 환경이나 로컬 ADC를 사용하는 경우 서비스 계정 이메일·키 대신 `FIREBASE_ADMIN_USE_APPLICATION_DEFAULT=true`를 사용할 수 있습니다.

암호화 키는 무작위 32바이트를 base64/base64url로 인코딩하거나 64자리 hex로 설정합니다. 다음 명령은 새 키를 생성합니다. 출력은 비밀 저장소에 보관하고 환경변수에만 입력합니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

기존 `PRISM_CONNECTIONS_ENCRYPTION_KEY`가 설정되어 있다면 새 변수를 추가하지 않아도 됩니다. 두 변수가 모두 있으면 `PRISM_API_KEYS_ENCRYPTION_KEY`가 우선합니다. 저장 후 키를 바꾸거나 잃으면 기존 데이터를 복호화할 수 없으므로 배포마다 바꾸지 않습니다. 모든 실행 서버에서 같은 키를 사용해야 합니다. 로컬과 배포 사이트가 같은 Firebase를 사용한다면 암호화 키도 같아야 합니다. 관리자 키와 암호화 키에는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

`firestore.rules`는 브라우저의 직접 접근을 거부합니다. Firebase Admin 서비스 계정에는 해당 프로젝트의 Firestore 읽기·쓰기 IAM 권한이 필요합니다. 인덱스 설정은 암호문 인덱싱을 비활성화합니다. Firebase CLI 프로젝트를 지정해 규칙·인덱스를 적용할 수 있습니다.

```sh
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

암호화 변수가 없으면 설정 화면에 브라우저 세션 저장 모드가 표시됩니다. 변수가 있는데 잘못되었거나 Firestore에 접근할 수 없으면 오류를 표시하고 동기화와 저장된 키 사용을 중지합니다.

## 사용과 확인

1. PC에서 사용할 배포 사이트에 Google 로그인하고 설정에서 API 키를 입력한 뒤 저장합니다. 기존 브라우저에 입력한 키도 저장 버튼을 누르면 업로드됩니다.
2. 모바일에서 같은 배포 사이트·Google 계정으로 로그인합니다. 설정에 ‘계정에 저장됨’ 상태가 표시됩니다. 저장된 키 값은 입력란에 다시 표시하지 않습니다.
3. API 키 방식으로 연결 테스트를 실행하거나 토론을 시작합니다. 키 복호화와 AI 요청은 서버에서 실행합니다. 모바일에서 로컬 플랜 연결 방식을 별도로 선택할 필요가 없습니다.
4. 키 교체는 새 값을 입력하고 저장합니다. 빈 입력란은 기존 키를 유지합니다. 삭제 버튼은 삭제 예약을 표시하며 저장하면 해당 키를 삭제합니다. 전체 초기화는 계정에 저장된 세 키도 삭제합니다.

키 저장·삭제는 다른 기기에서 설정을 다시 열거나 화면으로 돌아왔을 때 반영됩니다. 스튜디오는 화면 복귀와 주기적 갱신으로 상태를 확인하며, 토론 시작 때 서버에서 최신 키를 다시 읽습니다. 모델과 연결 방식은 각 브라우저에서 선택합니다. 로그아웃해도 계정에 저장한 키는 유지됩니다.

## 보관 방식

`prismApiKeys/{SHA256(Firebase UID)}`에 AES-256-GCM으로 암호화한 키 묶음을 저장합니다. 암호문 인증에 UID를 포함해 다른 계정으로 문서를 복사해도 복호화되지 않습니다. 부분 수정은 Firestore 트랜잭션으로 수행합니다. API는 서버가 검증한 UID로만 문서를 선택하며, 화면의 계정 헤더는 계정 변경을 감지하는 용도로만 사용합니다.

브라우저에는 저장된 제공자 목록만 전달합니다. 성공적으로 동기화한 API 키는 브라우저 설정 캐시에서 제거합니다. 키 삭제 후에는 이전 브라우저 키나 공용 서버 환경변수로 자동 대체하지 않습니다. 기기 간 기록 동기화는 [기록 동기화 안내](./history-sync.md)를 참고하세요.
