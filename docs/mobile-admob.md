# AIsle Android AdMob (Capacitor)

Capacitor Android 셸에서 **네이티브 AdMob 배너**를 표시합니다. WebView는 `https://www.aisleshub.com` 을 로드하므로 광고 브리지 코드는 **Vercel에 배포된 Next.js** 에 포함되어야 합니다.

## 광고 단위 (프로덕션)

| 항목 | ID |
|------|-----|
| App ID | `ca-app-pub-2237287742271246~5141113207` |
| 배너 | `ca-app-pub-2237287742271246/6354915116` |
| 네이티브 (예약) | `ca-app-pub-2237287742271246/3366328699` |

`public/app-ads.txt` 에 `pub-2237287742271246` 이 이미 등록되어 있습니다.

## 구현 요약

| 위치 | 역할 |
|------|------|
| `mobile/package.json` | `@capacitor-community/admob@^7.2.0` |
| `mobile/android/.../AndroidManifest.xml` | `com.google.android.gms.ads.APPLICATION_ID` |
| `mobile/android/.../strings.xml` | `admob_app_id` |
| `src/lib/admob-capacitor.ts` | 초기화·배너 표시·테스트 모드 |
| `src/components/AdMobCapacitorInit.tsx` | 앱 로드 시 하단 배너 |
| `src/components/NativeAdSlot.tsx` | 홈 피드 네이티브 슬롯 (예약) |

### 배너 정책

- **위치**: 화면 하단 고정 (`BannerAdPosition.BOTTOM_CENTER`, Adaptive)
- **숨김**: `/login`, `/auth/*` — 로그인·인증 UI와 겹치지 않음
- **상단 safe area**: `CapacitorSafeArea` 가 헤더 inset 을 처리; 배너는 하단만 사용
- WebView 본문은 `--app-ad-banner-height` 만큼 `padding-bottom` 으로 배너에 가리지 않음

### 네이티브 광고 제한

`@capacitor-community/admob` **7.x 는 Native 형식을 지원하지 않습니다** (배너·전면·보상만 지원).  
`ADMOB_NATIVE_UNIT_ID` 와 `NativeAdSlot` 은 향후 커스텀 Capacitor 플러그인 또는 플러그인 업데이트 시 사용할 **예약 슬롯**입니다. MVP에서는 **하단 배너만 실제 노출**됩니다.

## 테스트 광고

프로덕션 URL을 로드하는 앱에서는 `NODE_ENV` 가 항상 `production` 이므로, 테스트는 환경 변수로 제어합니다.

```bash
# Vercel Preview 또는 로컬 .env
NEXT_PUBLIC_ADMOB_TEST_MODE=true
```

- `true`: Google 공식 Android 테스트 배너 ID + `isTesting` / `initializeForTesting`
- 미설정 또는 `false`: 프로덕션 배너 단위 ID

Android Studio **debug APK** 에서도 위 플래그가 켜진 빌드가 배포되어 있어야 테스트 광고가 보입니다.  
내부 테스트 트랙·프로덕션 배포 전에는 Vercel에서 `NEXT_PUBLIC_ADMOB_TEST_MODE` 를 제거하거나 `false` 로 두세요.

### 기기에서 확인

1. `NEXT_PUBLIC_ADMOB_TEST_MODE=true` 로 Vercel 배포 (또는 프로덕션 ID + 정책 준수 테스트)
2. `npm run mobile:sync` 후 Android Studio에서 앱 재설치
3. 홈 진입 → 화면 **하단**에 배너(또는 테스트 광고) 표시
4. `/login` 이동 → 배너 숨김 확인

## 개인정보·정책

- AdMob SDK 사용 시 [Google Play 데이터 안전](https://support.google.com/googleplay/android-developer/answer/10787469) 및 **개인정보처리방침**에 광고·기기 광고 ID 수집 내용을 반영해야 할 수 있습니다.
- iOS는 현재 미구현; 추후 `Info.plist` `GADApplicationIdentifier` 및 ATT 문구가 필요합니다.

## 동기화·빌드

```bash
cd mobile && npm install
cd .. && npm install
npm run mobile:sync
npm run mobile:open:android
```

Android Studio에서 Run 후 `https://www.aisleshub.com` 이 로드되고, **웹 배포에 AdMob 코드가 포함된 뒤**에만 광고가 동작합니다.

## 관련 문서

- [mobile-capacitor.md](./mobile-capacitor.md) — Capacitor 셸 전반
- [mobile-play-release.md](./mobile-play-release.md) — Play 스토어 릴리스
