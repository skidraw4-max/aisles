# Plan: Android 16 target + replace AIsle app AdMob with Kakao AdFit

**Status:** Implemented; Play upload pending signed release keystore.

## Source Finding

- Google Play warning requires Android 16 / API 36 or higher target before 2026-08-31.
- Current AIsle Android shell:
  - `compileSdkVersion = 35`
  - `targetSdkVersion = 35`
  - `versionCode = 10`
  - `versionName = 1.2.7`
- Local Android SDK already has `android-36`, `android-36.1`, and build-tools 36.x.
- Web already has Kakao AdFit units and loader, but Capacitor native paths currently skip Kakao slots and use AdMob:
  - `@capacitor-community/admob`
  - Android manifest AdMob app id
  - custom native `AislesAdPlugin` using Google Mobile Ads
  - `AdMobCapacitorInit` in root layout

## Proposed Fix

1. Add a focused static check script first:
   - assert API 36 target/compile
   - assert app version bump
   - assert Android/TS source no longer references AdMob/Google Mobile Ads plugin code
   - assert Capacitor WebView does not skip Kakao AdFit slots
2. Android compliance:
   - bump `compileSdkVersion` and `targetSdkVersion` to `36`
   - bump upload version to `versionCode 11`, `versionName 1.2.8`
3. Ad replacement:
   - remove AdMob Capacitor package, settings, Gradle dependency, manifest metadata, strings, and native plugin registration/source
   - remove TS AdMob initialization/plugin bridge
   - allow `KakaoAdFitLoader`, `AdBanner`, and `GamePlayAds` to render in Capacitor WebView
   - replace native feed ad slots with Kakao AdFit in-feed slots
   - load Google AdSense script only on non-Capacitor web browsers
4. Verification:
   - run static mobile compliance check
   - run Kakao AdFit tests
   - run web build
   - run Android Gradle build/sync enough to prove API 36 config is valid

## Notes

- Existing Kakao AdFit unit IDs in `src/lib/kakao-adfit.ts` will be reused unless new unit IDs are provided.
- Play Console production release still requires uploading the generated Android artifact manually or via a configured Play publishing flow.

# Plan: Fix Search Console crawled-not-indexed resources

**Status:** Completed.

## Source Finding

Google Search Console export:

- Issue: `크롤링됨 - 현재 색인이 생성되지 않음`
- Sitemap scope: `알려진 모든 페이지`
- Sample URLs are mostly:
  - `/_next/static/css/*.css?dpl=...`
  - `/og/post/{id}`

These are not canonical content pages. `/og/post/{id}` is a dynamic Open Graph image route referenced from `/post/{id}` metadata, and `/_next/static/css/*` are render assets. They should remain crawlable for rendering/sharing but should not be treated as indexable documents.

## Proposed Fix

1. Add a small shared constant for resource-only SEO headers:
   - `X-Robots-Tag: noindex`
2. Add the header to dynamic OG image responses:
   - `src/app/og/post/[id]/route.tsx`
   - fallback response in `src/lib/og-fallback-response.ts`
3. Add Next headers for static/generated assets in `next.config.ts`:
   - `/_next/static/:path*`
   - `/og-image.png`
4. Keep `/post/{id}` canonical pages indexable and keep CSS/images fetchable; do not add `robots.txt` disallow for `/_next/static`, because Google needs CSS for rendering.

## TDD / Verification

1. First add a focused failing check script that asserts expected noindex headers are configured.
2. Implement the headers.
3. Run:
   - focused SEO header check
   - `npm run build`
4. Deploy to production after verification, then confirm production headers with HTTP requests.

## Deployment

- Use the existing Vercel deployment flow if CLI/auth is available locally.
- Do not commit unrelated existing dirty files.

# Plan: Portfolio PPT Refresh

**Status:** Completed.

## Goal

Create a modern PM/service-planning portfolio PowerPoint for 함종두 using:

- Resume PDF: `c:\Users\User\Documents\이력서_함종두.pdf`
- Existing Google Slides portfolio: `https://docs.google.com/presentation/d/1mWkTq8fTUqyE3cI6-ntesml1jsqvnAHm/edit?slide=id.p1#slide=id.p1`
- Public project links: AIsle Hub, Side-Sync, Google Play releases
- User preference: include full resume contact details, modern PM portfolio style, save to `Documents`

## Proposed Deck Structure

1. Cover: name, role, portfolio period, contact summary
2. Executive Summary: 19+ years across service planning, PM, UI/UX, app/web products
3. Core Competencies: service planning, UI/UX, product operations, analytics, Jira/Figma/Cafe24/GA
4. Career Timeline: Midway, Cafe24, Trumpia, Okiconcession, B4U Platform, Atomy, side projects
5. Atomy DX: global shopping mall renewal/operations and overseas rollout experience
6. Legacy Product Work: Cafe24, Trumpia, named.com, PLZ LUX/3D CAMERA
7. AIsle Hub: AI community, prompt archive, Korean AI news summaries, Gemini-based workflows
8. Side-Sync: side project matching, team-building workspace, Kanban/collaboration flow
9. Released Games: Classic Brick Breaker, MiniBrick: Infinite Trajectory, and any clearly verifiable additional release
10. Vibe Coding & Solo Build Capability: AI-assisted planning/development/launch/operation loop
11. Global/Overseas Experience: Kyrgyzstan, Taiwan, Vietnam, US assignment
12. Closing: product philosophy, links, contact

## Implementation Approach

- Generate a `.pptx` with `python-pptx` from structured slide content.
- Use a clean widescreen layout, dark/navy accent palette, concise Korean copy, and link buttons for public URLs.
- Do not modify application source code.
- Save output as `c:\Users\User\Documents\Portfolio_함종두_2026.pptx`.

## Verification

- Confirm the PPTX file is created and readable by checking slide count and file metadata.
- Re-open the generated deck programmatically enough to verify the expected slide titles exist.
- Report any source content that could not be accessed or verified.

# Plan: Fix game score bridge + ranking (empty MY/TOP)

**Status:** Implementing (parent mandate: investigate + fix + commit/push).

## Prod findings

1. **GameScore table exists** — `GET /api/games/brickbreaking/scores` returns 200 `{ entries: [], me: null }` (not 500). Migration is live. `run-build.cjs` runs `prisma migrate deploy` when `DIRECT_URL` is set.
2. **Path collision (critical)** — `public/games/{slug}/index.html` is served at `/games/{slug}` and **shadows** App Router detail pages. Hard load of `/games/brickbreaking` = Phaser HTML, not RankingBoard. Soft SPA nav from `/games` still shows React rankings.
3. **Play login gate ineffective** — Guests get full `/games/.../play` (no `NEXT_REDIRECT`); `/upload` soft-redirects. Guests can play → `GamePlayShell` drops POST when no Bearer → empty rankings. MY copy always says 「로그인 후 기록 표시」 when `me === null` (also when logged-in with no score).
4. **Bridge wiring** — Deployed shell listens for `aisle-game-score`; brick `postScore`/`endGame` and minibrick `endGame` call `notifyAisleParent`. Same-origin iframe OK; scores only fire on game over (not stage clear).

## Fixes

| # | Change |
|---|--------|
| A | Move embeds `public/games/{slug}/**` → `public/embeds/{slug}/**`; update `catalog.embedPath` (+ thumbnail paths). Restores `/games/[slug]` detail. |
| B | Play page: `force-dynamic` + server `getUser` → redirect `/login?next=…` (reliable vs middleware-only). |
| C | `GamePlayShell`: session via `getSession`+`refreshSession` fallback; warn on missing auth; keep origin check. |
| D | `GameRankingBoard`: `useAuth` for MY labels (guest vs logged-in no score); reload on `visibilitychange` / focus after return. |
| E | Brick: also `notifyAisleParent` on stage clear (current score). |
| F | Hardening: detail back link `router.refresh` optional via client wrapper; keep migrate in build. |
| G | TDD: extend score-bridge / ranking tests; `tsc`; commit+push. |

## Out of scope

- Replacing Google Sheets in-game boards.
- Middleware rewrite beyond play page server guard.

# Plan: Perceived load speed (home / nav / refresh)

**Status:** Implemented 2026-08-18 (approved). Play page login gate unchanged. AdFit/AdSense/GA untouched. `PG_POOL_MAX` unchanged.

## Source finding (2026-08-18, prod `www.aisleshub.com`)

- Every HTML/RSC response: `Cache-Control: private, no-cache, no-store` + `X-Vercel-Cache: MISS`.
- Serverless origin is `iad1` (US East) even though the edge is `icn1` (Seoul). Static `/_next/static` stays on `icn1` (~100ms).
- Home RSC navigation: TTFB ~0.3s but **stream total ~3.8s** for ~17KB. Hard refresh home: TTFB 0.5–3s, HTML stream up to ~10s.
- Cause chain: `(root)/layout.tsx` calls `getInitialSession()` → `cookies()` → whole tree dynamic; `revalidate = 60/3600` unused. Layout also awaits Supabase `getUser` + Prisma (notices, ui labels, fortune) **before children stream**. Home then runs more uncached Prisma (`getHomePageQueries`, `HomeQuasarBoard` without Suspense). `experimental.staleTimes.dynamic: 0` means every Link refetch.
- Feed/hero use `next/dynamic` `ssr: false`, so ALL 카드는 HTML에 없고 클라 청크 이후에 나타남. `(root)/loading.tsx` makes tab switches look like full reloads.

## Implemented

1. **Public shell / auth**
   - `(root)/layout.tsx` no longer calls `cookies()` / `getUser()`. Header login uses client `SessionProvider` (`authReady` skeleton until hydrate).
   - `hasSupabaseAuthCookie()` skips Supabase `getUser` when no `sb-*-auth-token` cookie (play page still `force-dynamic` + `getUser` after cookie check).
   - Layout notices/fortune stream behind Suspense. UI labels + rolling notices use `unstable_cache` so layout Prisma does not dynamize the tree.
   - `experimental.staleTimes.dynamic`: `0` → `30` (post views stay via `after()` + client +1).
2. **Vercel region:** `vercel.json` `regions: ["bom1"]`. Local `DATABASE_URL` host is `aws-1-ap-south-1.pooler.supabase.com` (Mumbai). **Not `icn1`** — DB is not Seoul. Closest Vercel region to that pooler is `bom1`.
3. **Home Data Cache + Quasar:** Date-safe `unstable_cache` (`serializeHomePageCache` ISO then revive). `HomeQuasarBoard` in Suspense + 60s cache; mode queries already parallel.
4. **Feed SSR + loading:** `HomeAllFeed` / `TodaysBest` / hero carousel SSR (removed `ssr: false`). Deleted `(root)/loading.tsx` so tab switches keep previous content. Post `loading.tsx` kept; `/games/loading.tsx` added.
5. **Games hub:** removed `force-dynamic`, `revalidate = 60`, parallel `findFirst` + cached highlights; score submit `revalidateTag('game-hub-highlights')`. Play page login gate unchanged.

## Deferred

- **PPR (`experimental.ppr`)** — Next 15.5 still experimental; client session restores Full Route Cache without it. Home `searchParams` may still keep `/` request-dynamic; `/post/[id]` is the ISR win.
- **Seoul `icn1` functions** — skipped; DB region is `ap-south-1`, not Korea.
- Raising `PG_POOL_MAX`; restoring old `unstable_cache` without Date-safe serialization.

# Plan: 내부 성장 레버 구현

**Status:** Implemented 2026-08-21 (approved sequential execution; no commit/push).

## Goal

내부 성장 방안을 **1→5 순서**로 적용해 검색 유입·구독 전환·공유·UGC 루프·게임 SEO를 강화한다. thin AI 스팸·가치 페이지 noindex·광고/성능 회귀는 금지.

## Scope (phases)

1. **복도 unique 메타 + 검색 `noindex,follow`**
   - LAB/GALLERY/LOUNGE/BUILD/LAUNCH/(crawlable others)에 AI_FORTUNE급 unique title/description/OG
   - `/search` → `SEO_ROBOTS_NOINDEX_FOLLOW` (`index:false, follow:true`)
   - sitemap: `/search` 제거(또는 저우선순위), GOSSIP 글 priority 하향, 고가치 복도 `/?category=` 정적 엔트리 추가
2. **다이제스트 / AI FORTUNE 구독 CTA**
   - `PostScrollSubscribeModal`, `FortuneDigestSubscribeCta` 카피·위치·임계값 소폭 개선
   - 기존 GA4 이벤트 유지 (`digest_modal_*`, `fortune_subscribe_cta_click`)
3. **동적 OG / 공유 카드 확대**
   - `post-dynamic-og.ts` eligibility: BUILD·LAUNCH·AI_FORTUNE·GALLERY(+ 기존 LAB/LOUNGE)
   - subtitle 매핑; `/og/post/[id]`·post `generateMetadata`는 helper 재사용
4. **UGC 주간 루프 노출**
   - 홈 ALL·BUILD/LAUNCH 교차 CTA, 상세 BUILD/LAUNCH에 복도 교차 프로모
   - 기존 `BuildHubSection` / `UgcWeeklyBest` / Launch 슬라이더 패턴 유지 (히어로 카드 남발 금지)
5. **게임 SEO + 스코어 공유(최소)**
   - robots: `/games` Disallow 제거, `/games/*/play` Disallow 유지
   - hub·detail → public index; play → private/noindex + 로그인 게이트 유지
   - sitemap: `/games`, `/games/[slug]`
   - 스코어 공유: 상세 Web Share + 게임 OG 메타(썸네일). 동적 스코어 OG 이미지는 시간 부족 시 defer

## Acceptance criteria

- [ ] 복도 `?category=` metadata가 카테고리별 unique title/description/OG
- [ ] 검색 결과 robots = noindex,follow; `/post/*`·복도 허브는 index 유지
- [ ] 동적 OG 대상에 BUILD/LAUNCH/AI_FORTUNE/GALLERY 포함
- [ ] 게임 hub/detail 색인 가능, play noindex + robots disallow
- [ ] AdFit/AdSense·anonymous session/ISR/bom1 미훼손
- [ ] 단위 테스트(메타/robots/OG eligibility/games index policy) 통과

## Primary files

- `src/lib/corridor-seo-meta.ts` (new), `src/lib/seo-robots.ts`, `src/lib/post-dynamic-og.ts`
- `src/lib/games-seo.ts` (new helpers), `src/app/robots.ts`, `src/app/sitemap.ts`
- `src/app/(root)/page.tsx`, `src/app/(root)/search/page.tsx`
- Subscribe CTA components + CSS
- `src/components/UgcCorridorCrossPromo.tsx` (new), home/post wiring
- `src/app/(root)/games/**`, optional `GameShareButton`
- Tests: `*.test.ts` beside helpers

## TDD plan

1. Failing tests first: corridor meta builder, `SEO_ROBOTS_NOINDEX_FOLLOW`, OG eligibility set, games indexable path policy / robots disallow list shape
2. Implement helpers → wire pages → run `node --import tsx --test …` + `tsc --noEmit` if practical

## What NOT to do

- thin AI 대량 자동 포스팅 / `/post/*`·복도 허브 noindex
- `/games/.../play` 색인 개방·로그인 게이트 제거
- GOSSIP sitemap high priority
- AdFit/AdSense 또는 최근 perf(anonymous session, ISR, bom1) 되돌리기
- commit/push (요청 전 금지)
- 전체 UI 리디자인

## Deferred

- **동적 스코어 OG 이미지** (`/og/games/[slug]?score=`) — 상세 Web Share + 게임 썸네일 OG로 최소 공유 가능. 점수 합성 카드는 후속.
- thin AI 대량 자동 포스팅 / 검색 허 리디자인 / AdFit·perf 되돌리기 — 범위 외.

## GSC verify (post-deploy, manual)

1. URL 검사: `/?category=LAB|BUILD|…`, `/search?q=test` (noindex), `/games`, `/games/brickbreaking`, `/games/.../play` (noindex)
2. 사이트맵 재제출 후 Coverage에서 games hub/detail 발견 확인
3. 공유 미리보기: BUILD/LAUNCH/AI_FORTUNE/GALLERY 글 OG 카드

# Plan: Add Bricks Match to games hub

**Status:** Implemented (local; commit deferred).

## Source Finding

- Source game: `c:\dev\Game\Bricks_match` (Capacitor web: `www/` = `index.html` + `css/` + `js/` + `assets/`).
- AIsle catalog today: `brickbreaking`, `minibrick` → `public/embeds/{slug}/`, hub `/games`, detail `/games/[slug]`, play iframe + login gate.
- Bricks Match modes: stage clear + endless run. No `aisle-game-score` postMessage yet (other embeds have `notifyAisleParent`).
- Slug: `bricks-match` (title: Bricks Match). Thumbnail: copy `assets/icon-512.png` → `thumbnail.png`.

## Implementation

1. TDD: extend `catalog.test.ts` / `ranking.test.ts` for slug + modes `stage` | `endless`.
2. Copy `www/` → `public/embeds/bricks-match/`; add score bridge in embed `js/app.js` (stage clear → `stage`, endless fail → `endless`).
3. Register in `catalog.ts`; update `ranking.ts` `isGameSlug` / `modesForGame` (no longer assume non-brick = mini).
4. Hub copy mentions third game lightly. SEO via existing `GAME_LIST` sitemap + detail index policy — no play gate change.
5. Verify: unit tests; hub shows 3 cards; `/games/bricks-match`, `/play` load embed.

## Out of scope

- Asset recompression; commit/push; native Capacitor packaging.

# Plan: 내부 성장 중기 레버 (1–6)

**Status:** Implemented 2026-08-21 — A(중기만), 위클리 자동 발행, 임베드 제외. 배포 진행.

## Goal

중기 제안만 적용: Fortune 고정 랜딩, BUILD/LAUNCH 주간 베스트 자동 글, 공유 UX, 게임 스코어 OG, 관련글 품질, 검색 복도·태그 허브.

## Scope

1. **`/fortune`** — 최신 AI_FORTUNE + 아카이브 링크, sitemap, 네비/인트로에서 허브 연결. `/post/[id]`는 글 canonical 유지.
2. **주간 UGC 위클리 자동 발행** — cron이 BUILD·LAUNCH 각각 `fetchUgcWeeklyTop` 스냅샷을 Post로 생성. 멱등 태그 `ugc-weekly:{CAT}:{ISO_WEEK}`. GitHub Actions 주간 스케줄 + `CRON_SECRET`.
3. **공유 UX** — 클립보드 성공 후 X/카카오 재공유 링크 노출 (`share_click` 유지).
4. **게임 주간 TOP 스코어 OG** — `/og/games/[slug]?mode=&period=weekly`, 상세 메타·공유에 연결.
5. **관련글** — 태그 교집합 우선, 부족 시 동일 카테고리 최신으로 채움.
6. **검색·태그** — corridor를 LAB/LOUNGE/GALLERY/AI_FORTUNE/BUILD/LAUNCH 등으로 확대. `/tags` 인기 태그 허브(index), `/tags/[tag]`는 검색으로 연결하되 thin URL은 noindex 유지 가능 — 허브만 public index.

## Out of scope

- PWA, 임베드 위젯, Android 스토어, GEO FAQ 심화(장기)
- thin AI 양산, AdFit/perf 되돌리기

## TDD

- ugc weekly idempotency tag helper
- related-posts ranking by tag overlap
- search corridor parse
- games score OG query params validation
- fortune archive list shape (unit where pure)

## Deploy

커밋 후 `origin/main` 푸시 → Vercel.

# Plan: 역분석 허브 (API 비로그인 체험 제외)

**Status:** Implemented 2026-09-02.

## Goal

문서 전략 중 **비용 없는** 항목만: Hero CTA, 공유·캐시 역분석 공개 읽기, GA4, LOUNGE/tags 브릿지. 비로그인 Gemini 호출(무료 체험)은 제외.

## Scope

1. Hero → GALLERY / 업로드(로그인) CTA + `hero_analysis_cta_click`
2. DB 캐시된 역분석 비로그인 읽기; 새 분석은 로그인 유지
3. GALLERY 상세 하단 CTA, `gallery_reverse_*` 이벤트
4. LOUNGE 상세 → GALLERY 역분석 예시 블록
5. `/tags` GALLERY 허브 링크, 검색 GALLERY 칩

## Out of scope

- 비로그인 무료 분석 API, `/analysis` URL, 메인에서 Game/Fortune 축소
