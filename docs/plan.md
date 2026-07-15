# Plan: Games per-game rankings + play login gate

**Status:** Approved (user: proceed with ranking proposal + login gate).

## Scope

### A. Per-game ranking (no cross-game board)

- **Hub `/games`**: each game card shows short **weekly top** highlights (e.g. Brick: stage 1st + infinite 1st). Remove unified hub scoreboard.
- **Detail `/games/[slug]`**: **Weekly | Overall** tabs; BrickBreaking + minibrick also **mode** tabs (`stage|infinite` / `normal|endless`). TOP list + MY row when logged in.
- **Data**: Prisma `GameScore` (`userId`, `gameSlug`, `mode`, `score`, `weekKey`, timestamps). `weekKey` = ISO week (`2026-W29`) for weekly rows, `"all"` for overall PBs. Upsert on submit only if new score is higher.
- **API**: `GET/POST /api/games/[slug]/scores` — GET public rankings; POST requires Bearer auth + `ensurePrismaUser`.
- Games currently store local/`localStorage` (Brick) or Google Apps Script (minibrick). Parent postMessage bridge is **later**; UI shows empty MY until scores are posted to our API.

### B. Login required to play

- Protect `/games/[slug]/play` in **middleware** → redirect `/login?next=…`.
- Hub/detail remain browsable; Play CTA goes to play URL (gate applies there).
- Menu stays hidden; robots already disallow `/games`.

## Out of scope

- Wiring iframe games to POST scores / postMessage.
- Main nav exposure, rewarded ads SDK.

## Verify

- Unit tests: weekKey, mode validation, ranking helpers.
- `npx tsc --noEmit`
- Manual: `/games`, `/games/brickbreaking`, `/games/brickbreaking/play` (logged out → login).
