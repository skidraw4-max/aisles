# Plan: Games host (BrickBreaking + minibrick)

**Status:** Approved (user: 2번부터 진행해줘 + PC 마우스/키보드·모바일 터치).

## Scope

- Host static builds under `public/games/brickbreaking`, `public/games/minibrick`.
- Play pages iframe same-origin HTML (`/games/.../index.html`).
- PC: BrickBreaking mouse follow + ←→/AD + Space; minibrick already has keyboard + pointer.
- Mobile: keep existing touch controls.
- Menu stays hidden; URL-only; robots/sitemap unchanged.
- Ad slots remain placeholders.

## Out of scope

- Rewarded/interstitial SDK wiring, live rankings, nav exposure, UGC.

## Verify

- `tsc --noEmit`
- Manual: `/games/brickbreaking/play`, `/games/minibrick/play`
