# Plan: Games mock hub (approved)

**Status:** Approved for mockup-only scope (user: 진행해줘).

## Scope

- Hidden games hub UI mock — **not** linked from MainNav, HomeContentTabs, or footer.
- Initial games: **BrickBreaking**, **minibrick**.
- Routes (URL-only access):
  - `/games` — hub + weekly/overall ranking stubs
  - `/games/brickbreaking`, `/games/minibrick` — detail + Play CTA
  - `/games/brickbreaking/play`, `/games/minibrick/play` — canvas placeholder, mid-ad + rewarded CTA stubs
- Soft mock: keep existing `(root)` site chrome; no nav menu items.
- Discovery: omit from sitemap; disallow `/games` in robots; `SEO_ROBOTS_PRIVATE` on pages.
- Visual: match `tmp-games-ui-mock/` (hub / detail / play). Play = placeholder (“게임 영역 (목업)”).
- Out of scope: real game embeds, ads SDK, live rankings, Nav exposure.

## Tests

- No page-level UI test pattern in repo → skip TDD; verify with `tsc --noEmit`.
