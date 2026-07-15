/**
 * Run: node --import tsx --test src/lib/ui-config-defaults.games-nav.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UI_CONFIG_SEED } from '@/lib/ui-config-defaults';
import { GAMES_NAV_HREF, GAMES_NAV_LABEL_KEY } from '@/lib/games-nav';

describe('games top navigation labels', () => {
  it('exposes corridor.games seed as 게임', () => {
    const row = UI_CONFIG_SEED.find((r) => r.key === GAMES_NAV_LABEL_KEY);
    assert.ok(row, 'corridor.games must exist in UI_CONFIG_SEED');
    assert.equal(row.value, '게임');
  });

  it('points games nav to /games', () => {
    assert.equal(GAMES_NAV_HREF, '/games');
  });
});
