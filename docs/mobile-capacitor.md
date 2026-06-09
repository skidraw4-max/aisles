# AIsle Android (Capacitor WebView)

Production 웹앱(`https://www.aisleshub.com`)을 Android 네이티브 셸로 감싸는 Capacitor 프로젝트입니다. Next.js 앱 코드는 변경하지 않고 `mobile/` 폴더만 추가했습니다.

## 구성

| 항목 | 값 |
|------|-----|
| App ID | `com.aisleshub.app` |
| App name | AIsle |
| WebView URL | `https://www.aisleshub.com` |
| 로컬 fallback | `mobile/www/index.html` (원격 로드 전 잠깐 표시) |

### 설치된 패키지

- `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` — Android 셸
- `@capacitor/app` — 앱 라이프사이클, 딥링크 (OAuth 준비)
- `@capacitor/browser` — 인앱/시스템 브라우저 OAuth (준비)

### 원격 URL 모드

`capacitor.config.ts`의 `server.url`로 프로덕션 사이트를 직접 로드합니다. 로컬 `www/`는 Capacitor가 요구하는 최소 `webDir`이며, 실제 UI는 항상 원격 URL에서 제공됩니다.

## 사전 요구사항

- [Android Studio](https://developer.android.com/studio) (최신 stable)
- JDK 17+ (Android Studio에 포함)
- USB 디버깅이 켜진 Android 기기 또는 에뮬레이터

Google Play Developer 계정은 이미 보유 중이므로 계정 생성 단계는 생략합니다.

## 개발 워크플로

```bash
# 의존성 (최초 1회)
cd mobile && npm install

# 설정/플러그인 변경 후 동기화
npm run mobile:sync          # 루트에서
# 또는
cd mobile && npx cap sync

# Android Studio 열기
npm run mobile:open:android  # 루트에서
# 또는
cd mobile && npx cap open android
```

Android Studio에서 **Run** (▶)으로 기기/에뮬레이터에 설치·실행합니다.

## Android Studio에서 실행 (수동)

1. `npm run mobile:open:android` 실행
2. Gradle sync 완료 대기
3. 상단 기기 선택 → **Run 'app'**
4. 앱이 열리면 `https://www.aisleshub.com` WebView가 로드되는지 확인

## 버전 관리

- `mobile/android/` — **커밋함** (팀/CI 재현성)
- `mobile/node_modules/`, 서명 키(`*.jks`, `key.properties`) — **커밋하지 않음**

## Google OAuth (Capacitor WebView)

Google은 임베디드 WebView에서 OAuth를 차단합니다. 앱에서는 **시스템 브라우저 + 딥링크**로 처리합니다.

### 흐름

1. WebView에서 `isCapacitorNative()` 감지
2. `signInWithOAuth` → `skipBrowserRedirect: true`, `redirectTo: com.aisleshub.app://auth/callback`
3. `@capacitor/browser`로 Google OAuth URL을 시스템 브라우저에서 열기
4. 인증 후 `com.aisleshub.app://auth/callback?code=...` 딥링크 → `appUrlOpen`
5. 브라우저 닫기 후 WebView를 `https://www.aisleshub.com/auth/callback?...` 로 이동 (기존 `exchangeCodeForSession` 재사용)

### 구현 위치

| 파일 | 역할 |
|------|------|
| `src/lib/capacitor-oauth.ts` | 네이티브/웹 OAuth 분기 |
| `src/components/AuthModal.tsx` 등 | `signInWithOAuth` 호출 |
| `mobile/android/.../AndroidManifest.xml` | `com.aisleshub.app` 스킴 intent-filter |

### USER ACTION REQUIRED: Supabase Redirect URLs

[Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 → **Authentication** → **URL Configuration** → **Redirect URLs**에 아래를 **모두** 추가:

```
https://www.aisleshub.com/auth/callback
com.aisleshub.app://auth/callback
```

Google Cloud Console의 OAuth 클라이언트 **Authorized redirect URIs**에는 Supabase가 안내하는 `https://<project-ref>.supabase.co/auth/v1/callback` 만 있으면 됩니다 (커스텀 스킴은 Supabase Redirect URLs에만 등록).

### 기기에서 Google 로그인 테스트

1. **웹 배포**: `capacitor-oauth.ts` 변경이 프로덕션(`https://www.aisleshub.com`)에 반영되어 있어야 합니다.
2. Supabase Redirect URLs에 커스텀 스킴 등록 (위).
3. `npm run mobile:sync` 후 Android Studio에서 앱 재설치·실행.
4. 로그인 모달 → **Google로 로그인** 탭.
5. Chrome(시스템 브라우저)에서 Google 계정 선택 → 앱으로 복귀 → 홈 또는 `next` 경로로 이동 확인.

| 증상 | 확인 |
|------|------|
| 브라우저만 열리고 앱 복귀 없음 | `AndroidManifest.xml` intent-filter, Supabase Redirect URLs |
| 앱 복귀 후 로그인 실패 | Vercel 로그 `/auth/callback`, PKCE `code` 쿼리 전달 여부 |
| WebView에서 Google 차단 | 시스템 브라우저가 열리는지 (`Browser.open`) |

## 다음 단계

### Play Store 릴리스

Play Console 경험이 있으므로 기존 게임과 동일한 흐름으로 진행:

1. **Release signing** — 업로드 키/앱 서명 키 생성 (`key.properties`는 로컬만 보관)
2. `mobile/android`에서 release 빌드 (Android Studio → Build → Generate Signed Bundle/APK → **AAB** 권장)
3. Play Console에 `com.aisleshub.app` 앱 생성 후 내부 테스트 → 프로덕션

### 선택적 개선

- 스플래시/아이콘 (`@capacitor/assets` 또는 Android 리소스 직접 수정)
- 푸시 알림, 상태바/네비게이션 바 스타일
- 오프라인 시 fallback UI 개선

## 문제 해결

| 증상 | 확인 |
|------|------|
| 빈 화면 | 기기 인터넷, `server.url` 접근 가능 여부 |
| SSL 오류 | `cleartext: false` — HTTPS만 허용 |
| Gradle 실패 | Android Studio SDK/Build Tools 업데이트 |
| sync 실패 | `cd mobile && npm install` 후 `npx cap sync` 재실행 |
