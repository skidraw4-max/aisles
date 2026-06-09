# AIsle Android AdMob (Capacitor)

Capacitor Android 셸에서 **네이티브 AdMob**을 표시합니다. WebView는 `https://www.aisleshub.com` 을 로드하므로 광고 브리지 코드는 **Vercel에 배포된 Next.js** 에 포함되어야 합니다.

## 광고 단위 (프로덕션)

| 항목 | ID |
|------|-----|
| App ID | `ca-app-pub-2237287742271246~5141113207` |
| 배너 (하단 Adaptive) | `ca-app-pub-2237287742271246/6354915116` |
| MREC 인피드 | **동일 배너 유닛** + `BannerAdSize.MEDIUM_RECTANGLE` (별도 MREC 유닛 생성 가능) |
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
| `src/lib/admob-capacitor.ts` | 초기화·하단 배너·인피드 MREC·테스트 모드 |
| `src/lib/feed-ad-slots.ts` | 5개 게시글마다 광고 슬롯 삽입 |
| `src/components/AdMobCapacitorInit.tsx` | 앱 로드 시 하단 배너 |
| `src/components/NativeAdSlot.tsx` | 인피드 MREC 슬롯 (DOM + 네이티브 오버레이) |
| `src/components/HomeAllFeed.tsx` | 홈 카드 그리드·LOUNGE/GOSSIP 목록에 슬롯 삽입 |

### 하단 배너

- **위치**: 화면 하단 고정 (`BannerAdPosition.BOTTOM_CENTER`, Adaptive)
- **숨김**: `/login`, `/auth/*`
- WebView 본문은 `--app-ad-banner-height` 만큼 `padding-bottom` (하단 배너 전용)

### 인피드 MREC (Medium Rectangle)

`@capacitor-community/admob` 는 **커스텀 (x, y) 좌표**를 지원하지 않습니다 (`TOP_CENTER` / `CENTER` / `BOTTOM_CENTER` + `margin` 만 가능).

**선택한 방식 (Option C):** 피드에 전체 너비 슬롯(`grid-column: 1 / -1`, min-height ~300px)을 두고, 슬롯이 뷰포트에 들어오면:

1. 하단 Adaptive 배너를 **일시 제거**
2. `BannerAdSize.MEDIUM_RECTANGLE` + `TOP_CENTER` + `margin`(슬롯 `getBoundingClientRect` 기준)으로 네이티브 오버레이 배치
3. 슬롯이 벗어나면 MREC 제거 후 **하단 배너 복원**

- **간격**: 카드 그리드·게시판 목록 모두 **5개 게시글마다** 1슬롯 (`FEED_AD_INTERVAL = 5`)
- **웹 브라우저**: 네이티브 광고 없음 — 점선 **「광고」** 플레이스홀더만 표시
- **동시 노출**: 플러그인이 배너 1개만 지원하므로 MREC 표시 중에는 하단 배너가 자동으로 숨겨집니다

## 테스트 광고

```bash
NEXT_PUBLIC_ADMOB_TEST_MODE=true
```

- `true`: Google 공식 Android 테스트 ID `ca-app-pub-3940256099942544/6300978111` + `initializeForTesting` / `isTesting`
- 배너·MREC 모두 동일 테스트 유닛에 **adSize** 로 크기만 구분

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
