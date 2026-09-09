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

- Issue: `?щ·留곷맖 - ?꾩옱 ?됱씤???앹꽦?섏? ?딆쓬`
- Sitemap scope: `?뚮젮吏?紐⑤뱺 ?섏씠吏`
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

Create a modern PM/service-planning portfolio PowerPoint for ?⑥쥌??using:

- Resume PDF: `c:\Users\User\Documents\?대젰???⑥쥌??pdf`
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
- Save output as `c:\Users\User\Documents\Portfolio_?⑥쥌??2026.pptx`.

## Verification

- Confirm the PPTX file is created and readable by checking slide count and file metadata.
- Re-open the generated deck programmatically enough to verify the expected slide titles exist.
- Report any source content that could not be accessed or verified.

# Plan: Fix game score bridge + ranking (empty MY/TOP)

**Status:** Implementing (parent mandate: investigate + fix + commit/push).

## Prod findings

1. **GameScore table exists** ??`GET /api/games/brickbreaking/scores` returns 200 `{ entries: [], me: null }` (not 500). Migration is live. `run-build.cjs` runs `prisma migrate deploy` when `DIRECT_URL` is set.
2. **Path collision (critical)** ??`public/games/{slug}/index.html` is served at `/games/{slug}` and **shadows** App Router detail pages. Hard load of `/games/brickbreaking` = Phaser HTML, not RankingBoard. Soft SPA nav from `/games` still shows React rankings.
3. **Play login gate ineffective** ??Guests get full `/games/.../play` (no `NEXT_REDIRECT`); `/upload` soft-redirects. Guests can play ??`GamePlayShell` drops POST when no Bearer ??empty rankings. MY copy always says ?뚮줈洹몄씤 ??湲곕줉 ?쒖떆??when `me === null` (also when logged-in with no score).
4. **Bridge wiring** ??Deployed shell listens for `aisle-game-score`; brick `postScore`/`endGame` and minibrick `endGame` call `notifyAisleParent`. Same-origin iframe OK; scores only fire on game over (not stage clear).

## Fixes

| # | Change |
|---|--------|
| A | Move embeds `public/games/{slug}/**` ??`public/embeds/{slug}/**`; update `catalog.embedPath` (+ thumbnail paths). Restores `/games/[slug]` detail. |
| B | Play page: `force-dynamic` + server `getUser` ??redirect `/login?next=?? (reliable vs middleware-only). |
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
- Home RSC navigation: TTFB ~0.3s but **stream total ~3.8s** for ~17KB. Hard refresh home: TTFB 0.5??s, HTML stream up to ~10s.
- Cause chain: `(root)/layout.tsx` calls `getInitialSession()` ??`cookies()` ??whole tree dynamic; `revalidate = 60/3600` unused. Layout also awaits Supabase `getUser` + Prisma (notices, ui labels, fortune) **before children stream**. Home then runs more uncached Prisma (`getHomePageQueries`, `HomeQuasarBoard` without Suspense). `experimental.staleTimes.dynamic: 0` means every Link refetch.
- Feed/hero use `next/dynamic` `ssr: false`, so ALL 移대뱶??HTML???녾퀬 ?대씪 泥?겕 ?댄썑???섑??? `(root)/loading.tsx` makes tab switches look like full reloads.

## Implemented

1. **Public shell / auth**
   - `(root)/layout.tsx` no longer calls `cookies()` / `getUser()`. Header login uses client `SessionProvider` (`authReady` skeleton until hydrate).
   - `hasSupabaseAuthCookie()` skips Supabase `getUser` when no `sb-*-auth-token` cookie (play page still `force-dynamic` + `getUser` after cookie check).
   - Layout notices/fortune stream behind Suspense. UI labels + rolling notices use `unstable_cache` so layout Prisma does not dynamize the tree.
   - `experimental.staleTimes.dynamic`: `0` ??`30` (post views stay via `after()` + client +1).
2. **Vercel region:** `vercel.json` `regions: ["bom1"]`. Local `DATABASE_URL` host is `aws-1-ap-south-1.pooler.supabase.com` (Mumbai). **Not `icn1`** ??DB is not Seoul. Closest Vercel region to that pooler is `bom1`.
3. **Home Data Cache + Quasar:** Date-safe `unstable_cache` (`serializeHomePageCache` ISO then revive). `HomeQuasarBoard` in Suspense + 60s cache; mode queries already parallel.
4. **Feed SSR + loading:** `HomeAllFeed` / `TodaysBest` / hero carousel SSR (removed `ssr: false`). Deleted `(root)/loading.tsx` so tab switches keep previous content. Post `loading.tsx` kept; `/games/loading.tsx` added.
5. **Games hub:** removed `force-dynamic`, `revalidate = 60`, parallel `findFirst` + cached highlights; score submit `revalidateTag('game-hub-highlights')`. Play page login gate unchanged.

## Deferred

- **PPR (`experimental.ppr`)** ??Next 15.5 still experimental; client session restores Full Route Cache without it. Home `searchParams` may still keep `/` request-dynamic; `/post/[id]` is the ISR win.
- **Seoul `icn1` functions** ??skipped; DB region is `ap-south-1`, not Korea.
- Raising `PG_POOL_MAX`; restoring old `unstable_cache` without Date-safe serialization.

# Plan: ?대? ?깆옣 ?덈쾭 援ы쁽

**Status:** Implemented 2026-08-21 (approved sequential execution; no commit/push).

## Goal

?대? ?깆옣 諛⑹븞??**1?? ?쒖꽌**濡??곸슜??寃???좎엯쨌援щ룆 ?꾪솚쨌怨듭쑀쨌UGC 猷⑦봽쨌寃뚯엫 SEO瑜?媛뺥솕?쒕떎. thin AI ?ㅽ뙵쨌媛移??섏씠吏 noindex쨌愿묎퀬/?깅뒫 ?뚭???湲덉?.

## Scope (phases)

1. **蹂듬룄 unique 硫뷀? + 寃??`noindex,follow`**
   - LAB/GALLERY/LOUNGE/BUILD/LAUNCH/(crawlable others)??AI_FORTUNE湲?unique title/description/OG
   - `/search` ??`SEO_ROBOTS_NOINDEX_FOLLOW` (`index:false, follow:true`)
   - sitemap: `/search` ?쒓굅(?먮뒗 ??곗꽑?쒖쐞), GOSSIP 湲 priority ?섑뼢, 怨좉?移?蹂듬룄 `/?category=` ?뺤쟻 ?뷀듃由?異붽?
2. **?ㅼ씠?쒖뒪??/ AI FORTUNE 援щ룆 CTA**
   - `PostScrollSubscribeModal`, `FortuneDigestSubscribeCta` 移댄뵾쨌?꾩튂쨌?꾧퀎媛??뚰룺 媛쒖꽑
   - 湲곗〈 GA4 ?대깽???좎? (`digest_modal_*`, `fortune_subscribe_cta_click`)
3. **?숈쟻 OG / 怨듭쑀 移대뱶 ?뺣?**
   - `post-dynamic-og.ts` eligibility: BUILD쨌LAUNCH쨌AI_FORTUNE쨌GALLERY(+ 湲곗〈 LAB/LOUNGE)
   - subtitle 留ㅽ븨; `/og/post/[id]`쨌post `generateMetadata`??helper ?ъ궗??
4. **UGC 二쇨컙 猷⑦봽 ?몄텧**
   - ??ALL쨌BUILD/LAUNCH 援먯감 CTA, ?곸꽭 BUILD/LAUNCH??蹂듬룄 援먯감 ?꾨줈紐?
   - 湲곗〈 `BuildHubSection` / `UgcWeeklyBest` / Launch ?щ씪?대뜑 ?⑦꽩 ?좎? (?덉뼱濡?移대뱶 ?⑤컻 湲덉?)
5. **寃뚯엫 SEO + ?ㅼ퐫??怨듭쑀(理쒖냼)**
   - robots: `/games` Disallow ?쒓굅, `/games/*/play` Disallow ?좎?
   - hub쨌detail ??public index; play ??private/noindex + 濡쒓렇??寃뚯씠???좎?
   - sitemap: `/games`, `/games/[slug]`
   - ?ㅼ퐫??怨듭쑀: ?곸꽭 Web Share + 寃뚯엫 OG 硫뷀?(?몃꽕??. ?숈쟻 ?ㅼ퐫??OG ?대?吏???쒓컙 遺議???defer

## Acceptance criteria

- [ ] 蹂듬룄 `?category=` metadata媛 移댄뀒怨좊━蹂?unique title/description/OG
- [ ] 寃??寃곌낵 robots = noindex,follow; `/post/*`쨌蹂듬룄 ?덈툕??index ?좎?
- [ ] ?숈쟻 OG ??곸뿉 BUILD/LAUNCH/AI_FORTUNE/GALLERY ?ы븿
- [ ] 寃뚯엫 hub/detail ?됱씤 媛?? play noindex + robots disallow
- [ ] AdFit/AdSense쨌anonymous session/ISR/bom1 誘명쎕??
- [ ] ?⑥쐞 ?뚯뒪??硫뷀?/robots/OG eligibility/games index policy) ?듦낵

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
2. Implement helpers ??wire pages ??run `node --import tsx --test ?? + `tsc --noEmit` if practical

## What NOT to do

- thin AI ????먮룞 ?ъ뒪??/ `/post/*`쨌蹂듬룄 ?덈툕 noindex
- `/games/.../play` ?됱씤 媛쒕갑쨌濡쒓렇??寃뚯씠???쒓굅
- GOSSIP sitemap high priority
- AdFit/AdSense ?먮뒗 理쒓렐 perf(anonymous session, ISR, bom1) ?섎룎由ш린
- commit/push (?붿껌 ??湲덉?)
- ?꾩껜 UI 由щ뵒?먯씤

## Deferred

- **?숈쟻 ?ㅼ퐫??OG ?대?吏** (`/og/games/[slug]?score=`) ???곸꽭 Web Share + 寃뚯엫 ?몃꽕??OG濡?理쒖냼 怨듭쑀 媛?? ?먯닔 ?⑹꽦 移대뱶???꾩냽.
- thin AI ????먮룞 ?ъ뒪??/ 寃????由щ뵒?먯씤 / AdFit쨌perf ?섎룎由ш린 ??踰붿쐞 ??

## GSC verify (post-deploy, manual)

1. URL 寃?? `/?category=LAB|BUILD|??, `/search?q=test` (noindex), `/games`, `/games/brickbreaking`, `/games/.../play` (noindex)
2. ?ъ씠?몃㏊ ?ъ젣異???Coverage?먯꽌 games hub/detail 諛쒓껄 ?뺤씤
3. 怨듭쑀 誘몃━蹂닿린: BUILD/LAUNCH/AI_FORTUNE/GALLERY 湲 OG 移대뱶

# Plan: Add Bricks Match to games hub

**Status:** Implemented (local; commit deferred).

## Source Finding

- Source game: `c:\dev\Game\Bricks_match` (Capacitor web: `www/` = `index.html` + `css/` + `js/` + `assets/`).
- AIsle catalog today: `brickbreaking`, `minibrick` ??`public/embeds/{slug}/`, hub `/games`, detail `/games/[slug]`, play iframe + login gate.
- Bricks Match modes: stage clear + endless run. No `aisle-game-score` postMessage yet (other embeds have `notifyAisleParent`).
- Slug: `bricks-match` (title: Bricks Match). Thumbnail: copy `assets/icon-512.png` ??`thumbnail.png`.

## Implementation

1. TDD: extend `catalog.test.ts` / `ranking.test.ts` for slug + modes `stage` | `endless`.
2. Copy `www/` ??`public/embeds/bricks-match/`; add score bridge in embed `js/app.js` (stage clear ??`stage`, endless fail ??`endless`).
3. Register in `catalog.ts`; update `ranking.ts` `isGameSlug` / `modesForGame` (no longer assume non-brick = mini).
4. Hub copy mentions third game lightly. SEO via existing `GAME_LIST` sitemap + detail index policy ??no play gate change.
5. Verify: unit tests; hub shows 3 cards; `/games/bricks-match`, `/play` load embed.

## Out of scope

- Asset recompression; commit/push; native Capacitor packaging.

# Plan: ?대? ?깆옣 以묎린 ?덈쾭 (1??)

**Status:** Implemented 2026-08-21 ??A(以묎린留?, ?꾪겢由??먮룞 諛쒗뻾, ?꾨쿋???쒖쇅. 諛고룷 吏꾪뻾.

## Goal

以묎린 ?쒖븞留??곸슜: Fortune 怨좎젙 ?쒕뵫, BUILD/LAUNCH 二쇨컙 踰좎뒪???먮룞 湲, 怨듭쑀 UX, 寃뚯엫 ?ㅼ퐫??OG, 愿?④? ?덉쭏, 寃??蹂듬룄쨌?쒓렇 ?덈툕.

## Scope

1. **`/fortune`** ??理쒖떊 AI_FORTUNE + ?꾩뭅?대툕 留곹겕, sitemap, ?ㅻ퉬/?명듃濡쒖뿉???덈툕 ?곌껐. `/post/[id]`??湲 canonical ?좎?.
2. **二쇨컙 UGC ?꾪겢由??먮룞 諛쒗뻾** ??cron??BUILD쨌LAUNCH 媛곴컖 `fetchUgcWeeklyTop` ?ㅻ깄?룹쓣 Post濡??앹꽦. 硫깅벑 ?쒓렇 `ugc-weekly:{CAT}:{ISO_WEEK}`. GitHub Actions 二쇨컙 ?ㅼ?以?+ `CRON_SECRET`.
3. **怨듭쑀 UX** ???대┰蹂대뱶 ?깃났 ??X/移댁뭅???ш났??留곹겕 ?몄텧 (`share_click` ?좎?).
4. **寃뚯엫 二쇨컙 TOP ?ㅼ퐫??OG** ??`/og/games/[slug]?mode=&period=weekly`, ?곸꽭 硫뷀?쨌怨듭쑀???곌껐.
5. **愿?④?** ???쒓렇 援먯쭛???곗꽑, 遺議????숈씪 移댄뀒怨좊━ 理쒖떊?쇰줈 梨꾩?.
6. **寃?됀룻깭洹?* ??corridor瑜?LAB/LOUNGE/GALLERY/AI_FORTUNE/BUILD/LAUNCH ?깆쑝濡??뺣?. `/tags` ?멸린 ?쒓렇 ?덈툕(index), `/tags/[tag]`??寃?됱쑝濡??곌껐?섎릺 thin URL? noindex ?좎? 媛?????덈툕留?public index.

## Out of scope

- PWA, ?꾨쿋???꾩젽, Android ?ㅽ넗?? GEO FAQ ?ы솕(?κ린)
- thin AI ?묒궛, AdFit/perf ?섎룎由ш린

## TDD

- ugc weekly idempotency tag helper
- related-posts ranking by tag overlap
- search corridor parse
- games score OG query params validation
- fortune archive list shape (unit where pure)

## Deploy

而ㅻ컠 ??`origin/main` ?몄떆 ??Vercel.

# Plan: ??텇???덈툕 (API 鍮꾨줈洹몄씤 泥댄뿕 ?쒖쇅)

**Status:** Implemented 2026-09-02.

## Goal

臾몄꽌 ?꾨왂 以?**鍮꾩슜 ?녿뒗** ??ぉ留? Hero CTA, 怨듭쑀쨌罹먯떆 ??텇??怨듦컻 ?쎄린, GA4, LOUNGE/tags 釉뚮┸吏. 鍮꾨줈洹몄씤 Gemini ?몄텧(臾대즺 泥댄뿕)? ?쒖쇅.

## Scope

1. Hero ??GALLERY / ?낅줈??濡쒓렇?? CTA + `hero_analysis_cta_click`
2. DB 罹먯떆????텇??鍮꾨줈洹몄씤 ?쎄린; ??遺꾩꽍? 濡쒓렇???좎?
3. GALLERY ?곸꽭 ?섎떒 CTA, `gallery_reverse_*` ?대깽??
4. LOUNGE ?곸꽭 ??GALLERY ??텇???덉떆 釉붾줉
5. `/tags` GALLERY ?덈툕 留곹겕, 寃??GALLERY 移?

## Out of scope

- 鍮꾨줈洹몄씤 臾대즺 遺꾩꽍 API, `/analysis` URL, 硫붿씤?먯꽌 Game/Fortune 異뺤냼

## Follow-up (2026-09-03)

濡쒓렇???ъ슜?먮뒗 `???대?吏 遺꾩꽍?섍린`媛 `/upload?category=GALLERY`濡?媛怨? 寃뚯뒪?몃쭔 `/login?next=`瑜??꾨떎. ?낅줈???섏씠吏 鍮꾨줈洹몄씤 由щ떎?대젆?몃룄 `category`瑜??좎??쒕떎.

# Plan: Add BrickInvasion + Ricorail to games hub

**Status:** Approved by user (?쒕떎瑜?寃뚯엫怨?媛숈? 議곌굔??. Implementing.

## Sources
- BrickInvasion: `c:\dev\Game\BrickInvasion\www` ??slug `brick-invasion`
- Ricorail: `c:\dev\Game\Puzzle_bricks` (package `ricorail`, webDir `dist`) ??slug `ricorail`

## Same conditions as existing games
1. Catalog + hub/detail/play routes via `GAME_LIST`
2. Embed under `public/embeds/{slug}/` (not `public/games/`)
3. Score bridge `aisle-game-score` postMessage; modes `stage` | `endless`
4. Login gate on play; hub/detail SEO indexable via existing games-seo
5. Thumbnail + hub copy update

## Out of scope
Asset recompression; Capacitor packaging of these games.

# Plan: Fix intermittent empty AI NEWS (LOUNGE) feed

**Status:** Implemented.

## Symptom
- AI NEWS shows empty-state copy while TodaysBest / fortune still load.
- Recovers after wait/refresh → transient SSR empty + no client recovery.

## Root cause
1. LOUNGE SSR fetches 24 posts with full `content` (heavy).
2. `fetchFeedPosts` swallows DB errors as `{ posts: [], hasMore: false }`.
3. That empty success can be stored in `unstable_cache` (60s).
4. `HomeAllFeed` never calls `/api/feed` when `hasMore === false` and posts empty.

## Fix
1. **Client:** one automatic `/api/feed` retry when initial feed is empty (`replace: true`).
2. **Server:** `fetchFeedPosts` rethrows on error (API route already catches); do not cache poisoned empty via swallowed errors.
3. **Payload:** clip `content` to snippet before return/cache (reuse existing snippet max); keep LOUNGE take as-is unless tests show need to reduce.

## TDD
- Pure helpers: empty-feed retry gate + content clip.
- Adjust `fetchFeedPosts` error behavior; verify API still returns empty JSON on failure.

## Out of scope
- TodaysBest loading UX
- Ad slot empty white box
- Changing LOUNGE take count unless needed after clip


