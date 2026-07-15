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
