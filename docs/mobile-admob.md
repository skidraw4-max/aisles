# AIsle Android AdMob (Capacitor)

Capacitor Android 셸에서 **네이티브 AdMob**을 표시합니다. WebView는 `https://www.aisleshub.com` 을 로드하므로 광고 브리지 코드는 **Vercel에 배포된 Next.js** 에 포함되어야 합니다.

## 광고 단위 (프로덕션)

| 항목 | ID |
|------|-----|
| App ID | `ca-app-pub-2237287742271246~5141113207` |
| 배너 (하단 Adaptive) | `ca-app-pub-2237287742271246/6354915116` |
| MREC 인피드 | **동일 배너 유닛** + `BannerAdSize.MEDIUM_RECTANGLE` (별도 MREC 유닛 생성 가능) |
| App Open | `ca-app-pub-2237287742271246/9608640126` |
| 전면 (Interstitial) | `ca-app-pub-2237287742271246/9220751606` |
| 네이티브 (미사용) | `ca-app-pub-2237287742271246/3366328699` |

`public/app-ads.txt` 에 `pub-2237287742271246` 이 이미 등록되어 있습니다.

### MREC AdMob 콘솔 참고

- `@capacitor-community/admob` 는 **배너 API**로 `MEDIUM_RECTANGLE`(300×250)을 요청합니다.
- 기존 **배너 유닛 ID**로 MREC 크기를 요청하는 방식이 일반적이며, 별도 **Medium rectangle** 유닛을 만들어도 됩니다.
- 네이티브(Native Advanced) 유닛 ID는 이 플러그인에서 사용하지 않습니다.

## 구현 요약

| 위치 | 역할 |
|------|------|
| `mobile/package.json` | `@capacitor-community/admob@^7.2.0` |
| `mobile/android/.../AndroidManifest.xml` | `com.google.android.gms.ads.APPLICATION_ID` |
| `mobile/android/.../strings.xml` | `admob_app_id` |
| `src/lib/admob-capacitor.ts` | 초기화·하단 배너·인피드 MREC·App Open·전면·테스트 모드 |
| `src/lib/aisles-ad-plugin.ts` | 인피드 MREC·App Open 네이티브 플러그인 (Android) |
| `mobile/android/.../AislesAdPlugin.java` | MREC `AdView` 좌표 배치 + `AppOpenAd` (v7 admob 미지원) |
| `src/lib/feed-ad-slots.ts` | 5개 게시글마다 광고 슬롯 삽입 |
| `src/components/AdMobCapacitorInit.tsx` | 앱 로드 시 하단 배너 |
| `src/components/NativeAdSlot.tsx` | 인피드 MREC 슬롯 (DOM + 네이티브 오버레이) |
| `src/components/HomeAllFeed.tsx` | 홈 카드 그리드·LOUNGE/GOSSIP 목록에 슬롯 삽입 |

### 하단 배너

- **위치**: 화면 하단 고정 (`BannerAdPosition.BOTTOM_CENTER`, Adaptive)
- **숨김**: `/login`, `/auth/*`
- WebView 본문은 `--app-ad-bottom-reserve` 로 `body::after` 스페이서 + `scroll-padding-bottom` (배너 높이 + safe-area + 간격)

### 인피드 MREC (Medium Rectangle)

`@capacitor-community/admob` 는 **커스텀 (x, y) 좌표**를 지원하지 않으며, `TOP_CENTER` + `margin` 으로는 피드 슬롯에 MREC를 안정적으로 맞출 수 없습니다 (`removeBanner` 레이스·`updateExistingAdView` 위치 미갱신 등).

**선택한 방식:** 앱 내 커스텀 Capacitor 플러그인 `AislesAd` (`mobile/android/.../AislesAdPlugin.java`)가 `showMrecAtRect({ top, left, width, height })` 로 WebView 좌표(dp)에 `AdView` 를 직접 배치합니다.

1. 하단 Adaptive 배너를 **일시 제거** (`@capacitor-community/admob`)
2. `AislesAd.showMrecAtRect` — 슬롯 `getBoundingClientRect()` 기준
3. 슬롯이 벗어나거나 가시성 &lt; 50% 이면 MREC 제거 후 **하단 배너 복원**

- **간격**: 카드 그리드·게시판 목록 모두 **5개 게시글마다** 1슬롯 (`FEED_AD_INTERVAL = 5`)
- **웹 브라우저**: 네이티브 광고 없음 — 점선 **「광고」** 플레이스홀더만 표시
- **동시 노출**: 플러그인이 배너 1개만 지원하므로 MREC 표시 중에는 하단 배너가 자동으로 숨겨집니다

### App Open·전면 (기본 비노출)

프로덕션에서는 **표시하지 않습니다**. 코드만 포함되어 있으며, 폐쇄 테스트 시에만 env 로 켭니다.

| 플래그 | 기본값 | 설명 |
|--------|--------|------|
| `NEXT_PUBLIC_ADMOB_APP_OPEN_ENABLED` | (미설정 / `false`) | 정확히 `true` 일 때만 App Open 로드·표시 |
| `NEXT_PUBLIC_ADMOB_INTERSTITIAL_ENABLED` | (미설정 / `false`) | 정확히 `true` 일 때만 전면 로드·표시 |

플래그가 `true` 가 **아니면** `prepare`·`show` 호출 없음 — 배너·MREC 와 충돌 없음.

#### App Open (플래그 ON 시)

- `@capacitor-community/admob` v7 에 App Open API 없음 → `AislesAd.prepareAppOpen` / `showAppOpen` (네이티브 `AppOpenAd`)
- **콜드 스타트**: WebView 로드 후 ~800ms 뒤 표시
- **백그라운드 복귀**: Capacitor `App` `appStateChange` → `isActive` 시 표시
- `/login`, `/auth/*` 에서는 표시 안 함

#### 전면 Interstitial (플래그 ON 시)

- `@capacitor-community/admob` `prepareInterstitial` + `showInterstitial`
- **트리거**: 라우트 이동 **8회** 이후 세션당 **최대 1회** (보수적)
- `/login`, `/auth/*` 에서는 표시 안 함

### 폐쇄 테스트에서 켜기

Vercel(또는 빌드 env)에 예시:

```bash
NEXT_PUBLIC_ADMOB_TEST_MODE=true
NEXT_PUBLIC_ADMOB_APP_OPEN_ENABLED=true
NEXT_PUBLIC_ADMOB_INTERSTITIAL_ENABLED=true
```

배포 후 `npm run mobile:sync` → Android 앱 재설치.

## 프로덕션 배포 (Vercel)

실제 광고를 노출하려면 Production 환경 변수에서 **테스트 모드를 끄세요**:

```bash
# 미설정 또는 false — 프로덕션 배너 유닛 ID 사용
NEXT_PUBLIC_ADMOB_TEST_MODE=false
```

`NEXT_PUBLIC_ADMOB_APP_OPEN_ENABLED` / `NEXT_PUBLIC_ADMOB_INTERSTITIAL_ENABLED` 는 미설정(기본)이면 비노출입니다.

변경 후 Vercel 재배포 → `npm run mobile:sync` → 앱 재설치(또는 WebView 캐시 삭제).

## 테스트 광고

```bash
NEXT_PUBLIC_ADMOB_TEST_MODE=true
```

- 정확히 `true` 일 때만: Google 공식 Android 테스트 ID + `initializeForTesting` / `isTesting`
- 배너·MREC: `ca-app-pub-3940256099942544/6300978111` (adSize 로 크기 구분)
- App Open: `ca-app-pub-3940256099942544/3419835294`
- 전면: `ca-app-pub-3940256099942544/1033173712`

### 기기에서 확인

1. `NEXT_PUBLIC_ADMOB_TEST_MODE=true` 로 Vercel 배포
2. `npm run mobile:sync` 후 Android Studio에서 앱 재설치
3. 홈 피드 스크롤 → 5·10·15… 번째 게시글 뒤 **300×250** 영역에 테스트 MREC
4. 해당 슬롯이 화면 밖으로 나가면 **하단 배너** 복귀
5. `/login` → 모든 광고 숨김

## 개인정보·정책

- AdMob SDK 사용 시 [Google Play 데이터 안전](https://support.google.com/googleplay/android-developer/answer/10787469) 및 개인정보처리방침에 광고·기기 광고 ID 수집 내용을 반영해야 할 수 있습니다.
- iOS는 현재 미구현.

## 동기화·빌드

```bash
cd mobile && npm install
cd .. && npm install
npm run mobile:sync
npm run mobile:open:android
```

## 관련 문서

- [mobile-capacitor.md](./mobile-capacitor.md)
- [mobile-play-release.md](./mobile-play-release.md)
