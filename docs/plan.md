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



# Plan: Fortune hub + report readability

**Status:** Approved by user (3 proposals + deploy). Implementing.

## Scope
1. Hub dark-theme contrast fix (latest card light bg + light text)
2. Hub scanability: human week labels, strip [AI FORTUNE] prefix, archive spacing/hierarchy
3. Report body: softer neon, higher body contrast, more section/card spacing, quieter scanline

## Out of scope
Content generation / Gemini copy changes

# Plan: Fix empty AI Work after new post

**Status:** Approved (수정안 진행 + 배포). Implementing.

## Cause
- POST /api/posts does not call revalidatePostCaches
- Upload soft-nav replace without router.refresh
- Quasar unstable_cache can keep stale/empty labGallery up to 60s; fetchLatestForCategory swallows DB errors as []

## Fix
1. Call revalidatePostCaches after successful create (JSON + multipart); also revalidatePath(/)
2. UploadForm: router.refresh() after replace
3. fetchLatestForCategory rethrows on DB error; bump home-quasar-payload cache key to v2

## TDD
- Assert home cache tags / paths helpers used by revalidatePostCaches

# Plan: AI FORTUNE catch-up schedule + missing weeks backfill

**Status:** Approved. Implementing.

## Goals
1. Generate missing weeks since 2026-08-W4 (through current week)
2. Prevent skip when GitHub Actions is delayed past Mon 05:00 KST

## Approach
- Schedule window: allow anytime after Mon 05:00 KST of the containing week (through next Mon 04:59)
- Pin weekKey to that week Monday so Tue catch-up does not shift month-week
- GH Actions: extra Mon retries + Tue 05:00 KST catch-up
- Backfill script/API range 2026-08-W5 .. current week; run locally with Gemini+DB
# Plan: AI Review Board (AI 운영위원회) — 1차

**Status:** Approved / shipped (`612f683`). Sample run `run-2026-09-17T07-53-24-323Z` preserved.

**승인 결정:** 파일 JSON (`data/ai-review-board/`) · 로컬 CLI만 · EvidencePack DB 집계 읽기 허용(쓰기 금지) · SEO/GEO 분리 · Admin은 결과 관찰만 · Cron 미연결.

**Hard rules (1차):** 서비스 코드 자동 수정·자동 배포·광고 변경·사용자 데이터 삭제 금지. 기존 Prisma 스키마 변경 금지. Gemini는 CLI 수동 실행 + 호출 상한만.

# Plan: AI Review Board v2 — EvidencePack metric clarity experiment

**Status:** Shipped (`a0d6c5f`). Sample run `run-2026-09-17T09-27-13-078Z` preserved.

# Plan: AI Review Board v3 — Honest revisionStatus experiment

**Status:** Shipped. Sample run `run-2026-09-17T10-09-59-178Z` preserved (v1/v2 untouched).

**Result:** 5/5 UNCHANGED with explicit keep-reasons; PARTIAL/FULL = 0. Mechanism works; this evidence pack + peer consensus did not produce opinion-overturning rebuttals.

# Plan: AI Review Board v5 — Claim Calibration Experiment

**Status:** Shipped. Sample `run-2026-09-17T10-55-31-639Z` (v1–v4 untouched).

**Result (honest):** Claims decomposed (23 SUPPORTED / 3 PARTIALLY_SUPPORTED). Revision still 5/5 UNCHANGED, conf flat. Critic flagged unknown-as-evidence (E) and causal-without-evidence (A). Calibration→Revision wiring present; soft PARTIAL did not emerge.

# Plan: AI Review Board v6 — Claim → Revision Consistency

**Status:** Shipped. Sample `run-2026-09-17T11-15-53-412Z` (v1–v5 untouched).

**Result (honest):** 27 claims checked; 26 CONSISTENT / 1 INCONSISTENT (D/C006 UNKNOWN_AS_NEGATIVE_EVIDENCE). Revisions still 5/5 UNCHANGED; B/C006 PARTIAL+HIGH retained with RETAIN_WITH_JUSTIFICATION → CONSISTENT. Checker works without forcing revision rate.

## Goal
Not force PARTIAL/FULL. Verify **logical consistency** between Claim Calibration and Revision.
UNCHANGED allowed iff retainReason / revisionAction justifies Calibration gaps.

## Pipeline
Evidence → Independent → Debate → ClaimCalibration → Revision → **Consistency Check** → Critic → Chairman  
Calls target ≤25 (5+5+5+5+0 deterministic check +1+1 ≈ 22–23; checker is code not LLM). Cap 40.

## Additions
- `RevisionRecord.calibrationImpactAssessment` + `revisionAction` per affected claim
- `run.calibrationRevisionChecks[]` (CONSISTENT | PARTIALLY_CONSISTENT | INCONSISTENT)
- Critic: calibrationRevisionIntegrity + mismatch flags
- Chairman: Calibration→Revision Findings
- Admin: claimId ↔ revisionAction ↔ consistency (existing tabs)

## Out of scope
Force revision rates, Prisma, rewrite v1–v5, unrelated dirty commits, force push.

---

**승인 결정 (2026-09-17):**
1. `memberId` A–E (UI: AI-A…)
2. Calibration 입력 = own Independent + Debate + EvidencePack; supportLevel 최종 근거 = EvidencePack only (peer≠evidence)
3. Claim 추출 Calibration 1회만; Revision 후 재추출 없음
4. UNKNOWN≠negative evidence; no force PARTIAL/FULL/confidence↓; 22 calls ≤40; v1–v4 untouched

## Goal
Claim → Evidence → supportLevel first; Revision follows naturally.

## Architecture
EvidencePack → Independent → Debate → ClaimCalibration×5 → Revision×5 → Critic → Chairman (22 calls)

## Out of scope
Force revision rates, Cron, Prisma, rewriting old runs, unrelated dirty commits, force push.

---

# Plan: AI Review Board v4 — Revision quality (UNCHANGED vs PARTIAL vs FULL discrimination)

**Status:** Shipped. Sample run `run-2026-09-17T10-34-21-451Z` preserved (v1–v3 untouched).

**승인 결정 (2026-09-17):** Debate/Revision 분리 · Q1–Q12 JSON · Admin revisions 우선 · 17 calls.

**Result (honest):** 5/5 UNCHANGED; PARTIAL/FULL=0; confidence 0.9→0.9 all. Mechanism+answers recorded; claim-softening PARTIAL and confidence drop did not occur on this EvidencePack.

## Problem (from v4)
- A–E all UNCHANGED; confidence 0.9→0.9
- WeakEvidence / NeedsVerification found but claim strength barely changed
- Gap *detection* exists; gap *impact on own claims* under-evaluated
- Some treat `activeUsersLast7d`/`viewsLast7d` = null as reinforcing “bad engagement”

## Goal
Not “did they revise?” first — **“how far does EvidencePack justify each claim?”**  
Claim → Evidence → supportLevel. Revision follows naturally; **never force revision.**

## Success criteria (not revision rate)
- DIRECT_FACT vs INFERENCE vs HYPOTHESIS vs UNKNOWN
- UNKNOWN ≠ “low/absent/worse”
- Overclaim / causal-without-evidence detection
- evidenceImpact on core claims
- PARTIAL when core claims PARTIALLY_SUPPORTED/NOT_SUPPORTED require softening
- confidence tracks evidence quality; majority≠↑conf / ≠revision ground
- UNCHANGED when claims truly SUPPORTED; FULL only when core claim incompatible

## Architecture

```
EvidencePack
→ A–E Independent
→ A–E Debate (rebuttal only)
→ A–E Claim Calibration (new LLM ×5)
→ A–E Revision (receives calibration + debate)
→ F Critic (incl. claimCalibrationIntegrity …)
→ Chairman (Fact / Interpretation / Hypothesis separated)
```

**Expected calls: 22** (5+5+5+5+1+1) ≤ max 40. Log expected vs max before run.

### Data (backward compatible)

`run.claimCalibrations: ClaimCalibration[]` (+ `claim-calibrations.json`)

```ts
ClaimCalibration {
  memberId: 'A'|'B'|…   // JSON may also echo reviewer label in docs; code uses memberId
  claims: CalibratedClaim[]  // 3–7
}
CalibratedClaim {
  claimId, claimText, evidenceRefs[],
  evidenceType: DIRECT_FACT|INFERENCE|HYPOTHESIS|UNKNOWN,
  supportLevel: SUPPORTED|PARTIALLY_SUPPORTED|NOT_SUPPORTED,
  reason, missingEvidence[],
  evidenceImpact: NONE|LOW|MEDIUM|HIGH|CRITICAL,
  riskOfOverclaiming: LOW|MEDIUM|HIGH
}
```

Keep `debate[]`, `revisions[]`. **Never mutate v1–v4 JSON.**

### Prompt rules (calibration)
- DIRECT_FACT only from EvidencePack numbers/defs
- null metrics → UNKNOWN; never “low engagement” evidence
- Platform-wide engagement / stagnant → at best INFERENCE + PARTIALLY_SUPPORTED
- UX-as-cause / Gemini-boosts-engagement → HYPOTHESIS + NOT_SUPPORTED (unless direct evidence)
- Anti-herding: majority phrases banned as support ground

### Revision link
Pass each member’s `ClaimCalibration` into `revisionPass`. Guidance (not force):
- UNCHANGED if core claims SUPPORTED (or PARTIAL with low impact)
- PARTIAL if ≥1 core claim PARTIALLY_SUPPORTED/NOT_SUPPORTED needs scope/strength/conf change
- FULL only if core claim incompatible with evidence  
HIGH/CRITICAL evidenceImpact + unchanged confidence → require explicit `confidenceChangeReason`

### Critic additives
`claimCalibrationIntegrity`, `evidenceMappingIntegrity`, `unsupportedClaimFlags`, `overclaimingFlags`, `unknownAsEvidenceFlags`, `causalClaimWithoutEvidenceFlags`, `confidenceCalibrationFlags`, `herdingFlags` (+ keep v4 checks)

### Chairman additives
Confirmed Facts / Unknown / Supported / Partially Supported / Unsupported·Hypothesis / Disputed / Validated Improvements / Needs Verification / Revision Summary — no inventing missing cases

### Admin
Same tabs. Debate/Revision area shows claim table when present; else `—`. revisions-first fallback for old runs.

### TDD (before Gemini)
User list 1–20 + existing suite green. Fixtures for DIRECT_FACT SUPPORTED, UNKNOWN misuse flag, INFERENCE PARTIAL, HYPOTHESIS NOT_SUPPORTED, calibration→PARTIAL path (mock), v1–v4 load unchanged.

### Execution
Tests green → real Gemini (no stub/mock) → compare v1–v5 → commit `feat: add AI review board claim calibration experiment` → push origin/main (no force; no unrelated dirty).

## Out of scope
Force PARTIAL/FULL, Cron, Prisma, rewriting old runs, inventing FULL without conflict.

## Defaults (confirm or override)
1. **memberId** `A`–`E` in JSON (not string `"AI-A"`); Admin can display `AI-{id}`
2. Calibration input = **own Independent + own Debate + EvidencePack** (no peer revision peek; peers only as rebuttal context if needed — prefer EvidencePack-only for supportLevel)
3. Claims extracted **once** in Claim Calibration stage (not re-extracted after Revision)

---
- All A–E chose UNCHANGED, but often justified by peer consensus (“other reviewers agree”).
- Evidence gaps (`activeUsersLast7d`/`viewsLast7d` null) + overclaim risk (“platform engagement crisis”) did not lower confidence (~0.95).
- Goal is **not** higher revision rate — it is honest discrimination + confidence integrity.

## Success criteria (not revision rate)
1. Evaluate rebuttal strength
2. Separate direct evidence vs inference
3. Assess evidence-gap impact on own claims
4. Soften claim strength when needed (PARTIAL candidate)
5. Adjust confidence rationally
6. Do not use majority agreement as revision/retain/confidence ground
7. UNCHANGED requires concrete `retainReason` (what rebuttal reviewed + why keep)

## Architecture (proposed)

```
EvidencePack
→ A–E Independent (unchanged; peers stripped)
→ A–E Debate (rebuttal only — no revision decision)
→ A–E Revision Quality Pass (Q1–Q12; 1 shot; no peer revision peek)
→ F Critic (revision integrity checks)
→ Chairman (facts / unknown / hypotheses / revision summary)
```

### Why split Debate vs Revision
v3 folded revision into `debateTurn`, which encouraged “agree with peers → keep”.  
v4 makes Revision a **separate LLM call** after all debate turns exist, so each member revisits **own** opinion against EvidencePack + peer arguments without seeing others’ final revisionStatus.

Call budget: 5+5+5+1+1 = **17** (≤40). v1–v3 samples untouched.

### Data model (backward compatible)

**New** `RevisionRecord` (stored as `run.revisions[]`; also `revisions.json`):

| Field | Notes |
|-------|--------|
| `memberId` | A–E |
| `revisionStatus` | UNCHANGED \| PARTIAL \| FULL |
| `revised` | false iff UNCHANGED |
| `originalOpinion` | from independent |
| `revisionReason` | PARTIAL/FULL required; UNCHANGED → null |
| `retainReason` | UNCHANGED required (concrete); else null |
| `changedClaims` | string[]; PARTIAL/FULL |
| `newEvidenceAccepted` | string[] |
| `rejectedArguments` | `{ argument, reason }[]` |
| `confidenceBefore` | independent.confidence |
| `confidenceAfter` | post-revision |
| `confidenceChangeReason` | string |
| `finalOpinion` | after revision |
| `answersQ1toQ12` | optional short map for audit (or omit if token-heavy — **confirm**) |

**DebateTurn (v4 behavior):** keep agreement/disagreement/weakEvidence/missed/needsVerification.  
Revision fields on DebateTurn remain optional for v1–v3 UI; v4 may leave them unset or mirror from `RevisionRecord` for list metrics only — **no rewrite of old JSON**.

**CriticReport** additive optional:

```ts
revisionIntegrity?: { ok: boolean; flags: string[] }
evidenceGrounding?: { ok: boolean; flags: string[] }
overclaiming?: { ok: boolean; flags: string[] }
herding?: { ok: boolean; flags: string[] }  // or reuse herdingDetected + flags
confidenceIntegrity?: { ok: boolean; flags: string[] }
fabrication?: { ok: boolean; flags: string[] }
statusConsistency?: { ok: boolean; flags: string[] }
```

**FinalReport** additive optional structured blocks:

```ts
confirmedFacts?: string[]
unknownMissingData?: string[]
hypotheses?: string[]
disputedPoints?: string[]
validatedImprovements?: string[]
revisionSummary?: {
  unchanged: string[]
  partial: string[]
  full: string[]
  confidenceShifts: string[]
  claimSofteningFromEvidenceGap: string[]
  herdingRisks: string[]
}
```

Old runs missing fields → Admin shows `—`. **Tab structure unchanged.**

### Prompt rules (Revision)
- RULE 1–4 from user brief (no majority→UNCHANGED; no majority→↑confidence; evidence gap may → ↓confidence or PARTIAL; no auto-expand signup/comments=0 → platform-wide crisis)
- Q1–Q12 checklist in order
- Ban retain/revision grounds: “All reviewers agree”, “majority”, “consensus supports…”, etc.
- Do **not** instruct “you should choose PARTIAL”

### Debate prompt change
Strip revision decision from debate; focus rebuttal lists only (anti-herding peer critique).

### Observation / scripts
- Extend `computeRunObservationMetrics` for retainReason presence, confidence delta, status counts from `revisions` when present (fallback debate for v3).
- `compare-ai-review-runs.ts` accept v4 id; columns for confidenceBefore/After, herding/overclaim flags.
- `.gitignore` exception for new baseline run only after Gemini completes.

### Tests (TDD first — must pass before Gemini)
1. UNCHANGED + retainReason required path (mock)
2. PARTIAL + changedClaims
3. FULL + core claim change
4–7. confidenceBefore/After down/hold/up rules (unit on helpers + mock)
8. evidence gap → PARTIAL *allowed* (mock fixture)
9. weak counter → UNCHANGED allowed
10. strong counter → revision allowed
11–12. majority-only strings rejected by validator / mock assert
13. fabrication flag surface on critic mock
14. revisionStatus ↔ revised compatibility
15. loading v1/v2/v3 JSON still parses; no mutate fixtures

### Execution
After tests green: `npx tsx scripts/run-ai-review-board.ts` (real EvidencePack + Gemini, no stub/mock).  
Preserve v1–v3. Commit message: `feat: add AI review board revision quality experiment` → push `origin/main` (no force; no unrelated dirty files).

### Out of scope
Force PARTIAL/FULL, Cron, Prisma/schema changes, rewriting old runs, inventing FULL without conflicting evidence, new Admin tabs.

### Open questions (need answers before implement)
1. **Debate/Revision split:** Approve separate Revision LLM call (`run.revisions[]`) as above? Or enhance single `debateTurn` only (cheaper, weaker isolation)?
2. **Q1–Q12 storage:** Persist full answers in JSON for audit, or prompt-only (save tokens / smaller artifacts)?
3. **DebateTurn mirroring:** Mirror revision fields onto debate for v3 UI compatibility, or Debate tab reads `revisions` when present?
4. **Budget warning:** 17 calls OK (default max 40)?

---

# Plan: AI Review Board v2 — EvidencePack metric clarity experiment (archive note)

**Status:** Implementing

## Goals
1. Preserve `run-2026-09-17T07-53-24-323Z` untouched
2. Strengthen metricDefinitions + prompt guard (no debate/persona/critic/chairman redesign)
3. Run new Gemini experiment with corrected EvidencePack semantics for comparison

## Out of scope
Debate revision UX overhaul, automation, Cron, code auto-fix of product


## Scope
1. `/admin/ai-review-board` list: when, calls, cost, status, debate observation counts from existing run JSON
2. `/admin/ai-review-board/[runId]` Debate: show weakEvidence/missed/needsVerification + initial opinion
3. Critic structured view; keep existing tabs

## Out of scope
Pipeline, prompts, automation, Prisma, force rewrite of sample run

---

## 0. 현황 분석 요약 (보고 항목 1–6)

### 1. 프로젝트 구조
- 모노레포성 Next 앱: `src/app` (App Router), `src/lib` (도메인·크론·Gemini), `src/components`, `prisma/`, `scripts/`, `mobile/` (Capacitor), `.github/workflows/` (크론), `docs/`
- 공개 복도: LAB(RECIPE)·GALLERY·LOUNGE·GOSSIP·BUILD·LAUNCH·AI_FORTUNE 등 `Post.category`
- 관리자 UI 기존 위치: `src/app/(root)/admin/*`, `src/app/(root)/notices/admin`

### 2. 프레임워크 / 스택
- Next.js 15 + React 19 + TypeScript
- Prisma 7 + PostgreSQL (Supabase)
- Auth: `@supabase/ssr` + Prisma `User` (id = Supabase auth user id)
- AI: `@google/generative-ai` (Gemini Flash / Flash-Lite 체인)
- Hosting: Vercel (추정) + GitHub Actions cron → `/api/cron/*` + `CRON_SECRET`
- Mobile: Capacitor 7

### 3. 기존 데이터 구조 (관련분)
- `User.role`: USER | BUILDER | ADMIN
- `Post` + 뉴스/운세 전용 유니크 키, `AiMetadata`, `UiConfig`, `Notice`, `GameScore` 등
- 운영위원회용 테이블은 **없음**

### 4. 인증 구조
- 세션: Supabase cookie (`createClient` server)
- 관리자: `src/lib/auth/require-admin.ts` — `requireAdminAction` / `getViewerIsAdmin` → `User.role === ADMIN`
- middleware는 `/upload`, games play 위주 보호; **admin 경로는 페이지/액션에서 자체 검증**

### 5. 관리자 기능 (기존)
- `/admin/ui-settings` — UI 카피
- `/admin/launch-banners` — LAUNCH 홈 배너
- `/notices/admin` — 공지
- 패턴: page에서 `getViewerIsAdmin` 게이트 + server actions에서 `requireAdminAction`

### 6. AI API 연동 (기존)
- 키: `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY` 등 (`readGeminiApiKeyFromEnv`)
- 공통: `src/lib/gemini-prompt-analysis-engine.ts`, `src/lib/gemini-models.ts`
- 용도: LAB 프롬프트 분석, 갤러리 역분석, 뉴스 요약 크론, AI FORTUNE 주간 생성
- 레이트리밋 완화: `NEWS_SYNC_GEMINI_GAP_MS`, 모델 체인 폴백
- **Cursor SDK / 다중 LLM 벤더는 미도입**

---

## 1. 적용 위치 · 충돌 · 파일 (보고 7–9)

### 7. 어디에 추가할지
- **도메인 로직:** `src/lib/ai-review-board/` (오케스트레이션·페르소나·스키마·스토리지) — 기존 Gemini/뉴스/운세와 분리
- **관리 UI:** `src/app/(root)/admin/ai-review-board/` — 기존 admin 패턴 재사용
- **API:** `src/app/api/admin/ai-review-board/` (ADMIN 세션) 또는 Server Actions only
- **산출물 저장 (1차 권장):** 로컬/서버 파일 또는 DB **신규 테이블만** — 기존 Post/User 스키마 손대지 않음
- **문서:** `docs/ai-review-board.md` (운영 가이드)

### 8. 충돌 가능성
| 위험 | 완화 |
|------|------|
| 동일 Gemini 키 RPM/TPM (뉴스·운세 크론과 경합) | 관리자 수동 실행만, 동시 1세션, Flash-Lite 우선, 호출 간 gap, 선택적 별도 키 `AI_REVIEW_BOARD_GEMINI_API_KEY` |
| Vercel `maxDuration` (긴 파이프라인) | 단계별 job + 상태머신; 1차 로컬 CLI `scripts/run-ai-review-board.ts` 권장, 대시보드는 결과 뷰어 중심 |
| egress/DB 부하 | 1차는 읽기 전용 스냅샷(집계·공개 메타만), 사용자 PII 최소 |
| “자동 코드 수정” 유혹 | 파이프라인에 write/deploy 단계 없음; 산출물 = Markdown/JSON 개선안만 |
| Prisma migrate 사고 | 1차 **파일 스토리지**로 migrate 0회 가능 (아래 결정 문항) |

### 9. 필요 파일/폴더 (예정)
```
src/lib/ai-review-board/
  types.ts                 # Run, MemberOpinion, ScoreCard, DebateTurn, FinalReport
  personas.ts              # A–F + Chairman system prompts
  score-dimensions.ts      # 16(+GEO) 영역 enum
  evidence-pack.ts         # 읽기 전용 AIsle 스냅샷 빌더
  independence.ts          # 독립 분석 격리 보장
  debate.ts
  critic.ts                # AI-F
  chairman.ts
  orchestrator.ts          # 상태머신
  store.ts                 # JSON 파일 또는 Prisma adapter
  anti-herding.ts          # 동조 방지 프롬프트/체크
src/app/(root)/admin/ai-review-board/
  page.tsx
  AiReviewBoardClient.tsx
  [runId]/page.tsx
scripts/run-ai-review-board.ts
data/ai-review-board/      # gitignore 권장 (런 산출물)
docs/ai-review-board.md
```
TDD: `src/lib/ai-review-board/*.test.ts` (상태머신·스키마 파싱·독립성 가드)

---

## 2. Agent / 모델 전략 (보고 14 + 구성 2)

### 결론 (현실적 1차)
**동일 Gemini 백엔드 + 역할별 Persona(시스템 프롬프트) + 오케스트레이터가 “독립성”을 강제**하는 구조가 현재 AIsle·Cursor 환경에 가장 적합하다.

| 방식 | 적합도 | 이유 |
|------|--------|------|
| **A. Gemini 멀티 페르소나 (권장)** | 높음 | 기존 키·SDK·레이트리밋 패턴 재사용. Vercel/로컬 모두 가능 |
| B. 벤더 다중화 (Gemini+OpenAI+Claude) | 중·후순위 | 관점 다양성↑, 비용·키·스키마 파싱 복잡도↑. 2차 |
| C. Cursor SDK Agent × 6 | 낮음(런타임) | IDE/클라우드 Agent는 “레포 심층 분석”에 강하나 Vercel 서버리스 파이프라인과 맞지 않음. 비용·인증 별도 |
| D. Cursor Agent 하이브리드 | 보조로 권장 | **증거 패킷**만 Cursor/로컬 스크립트로 생성(코드·라우트 맵·성능 메모) → Gemini 위원회 입력. 위원회 본체는 Gemini |

**독립 Agent처럼 보이게 하는 방법 (동일 모델이라도):**
1. 멤버별 격리된 system prompt + 금지 규칙(“다른 위원 의견 가정 금지”)
2. 오케스트레이터가 독립 단계에서는 **타 위원 JSON을 컨텍스트에 넣지 않음** (코드 레벨 가드 + 테스트)
3. temperature/seed 약간 다르게 (선택)
4. AI-F·Chairman은 이후 단계에서만 전체 공개

---

## 3. 데이터 흐름

```
[Admin: Run 시작]
    → EvidencePack 생성 (읽기 전용)
         · 라우트/복도 목록, 공개 카테고리 글 수, 최근 크론 헬스, docs 요약,
           robots/SEO 메모, (선택) Lighthouse/수동 메모 stub
    → Phase INDEPENDENT: A,B,C,D,E 병렬 또는 순차 (서로 결과 비공개)
         · 각자: 상태/장점/문제/트렌드갭/우선순위/효과/난이도/위험/근거/confidence
         · 영역별 score + evidence[] 분리 저장
    → Phase DEBATE: 전원에게 타인 결과 공개
         · 동의/반대/근거부족/누락/추가검증/의견수정여부·이유
         · anti-herding: “단순 동조 금지, 수정 시 근거 필수”
    → Phase CRITIC (AI-F): 전체 검토 체크리스트
    → Phase CHAIRMAN: 가중 종합 보고서 (다수결/평균만 금지)
    → Store: run JSON + history events
    → Admin Dashboard 표시
    → (사람 검토) — 적용은 별도 개발 단계 (이 시스템 밖)
```

상태: `queued → collecting_evidence → independent → debate → critic → chairman → completed | failed`

---

## 4. DB / 스토리지 (보고 10) — 1차 결정 포인트

### 권장 A (1차 기본): 파일 JSON 스토어
- `data/ai-review-board/runs/{runId}.json` (+ `events.jsonl`)
- **기존 DB 마이그레이션 0** → 요구사항 §9와 정합
- gitignore; 로컬·관리자 머신에서 CLI 실행 후 결과 커밋/업로드 가능
- Vercel 읽기 전용 FS 제약 → **프로덕션 대시보드는 업로드된 아티팩트 또는 R2** 필요 시 1.1에서

### 대안 B: Prisma 신규 모델만 (additive)
```
ReviewBoardRun { id, status, startedAt, finishedAt, evidencePack Json, finalReport Json, createdBy }
ReviewBoardMemberOutput { id, runId, memberId, phase, payload Json, confidence, revisedFrom Json? }
ReviewBoardEvent { id, runId, type, actor, payload Json, createdAt }  // 토론·의견변경 감사로그
ReviewBoardScore { id, runId, memberId?, dimension, score, evidence Json }  // 점수/근거 분리
```
기존 User/Post **변경 없음**. migrate는 “신규 테이블만”.

**승인 시 A 또는 B 선택 필요.**

---

## 5. API (보고 11)

| 메서드 | 경로/액션 | 역할 |
|--------|-----------|------|
| Server Action / POST | `startReviewBoardRun` | ADMIN, EvidencePack+파이프라인 시작(또는 CLI 트리거 안내) |
| GET | `/admin/ai-review-board` | 런 목록 |
| GET | `/admin/ai-review-board/[runId]` | 상세·타임라인·점수·최종안 |
| (선택) POST | `/api/admin/ai-review-board/[runId]/cancel` | 중단 |
| **없음 (1차)** | 코드 패치·배포·DB mutate 엔드포인트 | |

인증: 전부 `requireAdminAction`. 공개 API 없음.

---

## 6. 환경변수 (보고 12)

| 변수 | 필수 | 설명 |
|------|------|------|
| 기존 Gemini 키 | 예 | 공용 가능 |
| `AI_REVIEW_BOARD_GEMINI_API_KEY` | 권장 | 크론과 격리 |
| `AI_REVIEW_BOARD_MAX_CALLS_PER_RUN` | 권장 | 기본 예: 40 |
| `AI_REVIEW_BOARD_MODEL` | 선택 | 기본 Flash-Lite |
| `AI_REVIEW_BOARD_ENABLED` | 권장 | 기본 false in prod until ready |
| Cursor | 1차 불필요 | 증거 패킷 보조 시만 로컬 |

---

## 7. 예상 비용 (보고 13)

가정: Flash-Lite, 멤버 5명 독립 + 5명 토론 + F + Chairman ≈ **12–20회** JSON 호출/런 (+ Evidence 0–2회).
- 입력에 EvidencePack·타인 분석 포함 시 토큰↑ → **런당 대략 $0.05–0.40** 수준(모델·패킷 크기 의존)
- 주 1회 수동: 무시 가능 / 일 다회: 키 할당량·뉴스 크론과 경합 주의
- Cursor Agent를 본체에 쓰면 **Cursor 과금 + Gemini 이중** → 1차 비권장

---

## 8. 관리자 화면 구조

`/admin/ai-review-board`
- 상단: Run 시작 (확인 모달: 예상 호출 수·비용 경고), 상태 배지
- 런 목록: id, 시각, status, overall score, confidence

`/admin/ai-review-board/[runId]`
- 탭: Overview | Members | Debate timeline | Critic | Scores | Final | Raw JSON
- Members: A–E 카드(독립 분석), 의견 변경 배지
- Debate: 시간순 이벤트 (동의/반대/수정 이유 강조)
- Scores: 영역별 0–100 + **근거 패널 분리**
- Final: Chairman 13개 섹션 고정 레이아웃

1차 UI는 **관찰 우선** (실행은 CLI여도 UI는 결과 뷰어 OK).

---

## 9. 점수·근거 스키마 (요지)

```ts
dimension: 'ui_ux' | 'visual' | 'mobile' | 'web_tech' | 'performance' | 'a11y' | 'usability'
  | 'content' | 'community' | 'ai_usage' | 'competitive' | 'acquisition' | 'retention'
  | 'seo_geo' | 'security' | 'scalability'
score: 0–100
evidence: { kind: 'observation'|'metric'|'doc'|'external_ref'|'inference'; text; source?; }
// inference만 있으면 confidence 자동 하향 + Critic 플래그
```

---

## 10. 기술적 문제와 해결

1. **장시간 파이프라인 / Vercel 타임아웃** → 1차 CLI 오케스트레이션; 또는 phase별 resume
2. **동조(herding)** → 토론 프롬프트에 반례 요구; Critic이 동조율 검사; 수정 시 reason 필수 스키마
3. **환각 점수** → evidence 없으면 score null 또는 cap; Chairman이 evidence 가중
4. **경쟁사/트렌드 실시간 검색 부재** → EvidencePack에 수동/문서 링크; 웹검색은 2차(또는 제한적 fetch allowlist)
5. **비밀·PII** → 스냅샷에 이메일·토큰 제외; ADMIN만 열람
6. **JSON 파싱 실패** → 기존 fortune/news와 동일 재시도·수정 프롬프트
7. **§9 “비용 발생 작업 실행”** → 구현 완료 후 **자동 cron 연결하지 않음**; 승인된 수동 실행만

---

## 11. 1차 구현 계획 (승인 후 작업 순서)

### In scope (1차)
1. 타입·페르소나·점수 차원·JSON 스키마 + **실패하는 테스트 먼저** (TDD)
2. EvidencePack 빌더 (읽기 전용, 안전 필드만)
3. Orchestrator: independent → debate → critic → chairman (파일 스토어)
4. CLI `scripts/run-ai-review-board.ts`
5. Admin 대시보드: 런 목록 + 상세 관찰 UI (실행 버튼은 feature flag)
6. docs + plan 상태 Approved로 갱신
7. **보안/성능 셀프리뷰 보고**

### Out of scope (1차)
- 프로덕션 코드 자동 수정 / PR 생성 / 배포
- 기존 DB 모델 변경, 사용자 데이터 삭제
- 광고·결제·크론 자동 연결
- Cursor SDK 본체 연동, 멀티벤더 LLM
- 적용 결과 측정 루프 (차기)

### 승인 전 확인 질문
1. 스토리지: **A 파일 JSON** vs **B Prisma 신규 테이블**?
2. 1차 실행 위치: **로컬 CLI만** vs **Admin 버튼으로 서버 실행**?
3. EvidencePack에 **프로덕션 DB 집계 읽기** 허용 여부 (카운트만)?
4. SEO+GEO를 한 차원(`seo_geo`)으로 둘지, 분리할지? (요청상 SEO, GEO — **분리 권장**)

---

## 12. 설계 철학 매핑
- 독립 → 토론 → 검증 → 종합 → 사람 검토: 오케스트레이터 단계로 고정
- “무엇을/왜/왜 바꿨는가”: `ReviewBoardEvent` + member `revision` 필드 필수
- 적용·측정은 시스템 경계 밖 (별도 개발 단계)
