/**
 * Run: node --import tsx --test src/lib/games/catalog.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_LIST, getGame, getGameEmbedPath } from './catalog';

describe('games catalog embed paths', () => {
  it('lists all registered hub games', () => {
    assert.deepEqual(
      GAME_LIST.map((g) => g.slug).sort(),
      ['brick-invasion', 'brickbreaking', 'bricks-match', 'minibrick', 'ricorail'],
    );
  });

  it('exposes same-origin static embed paths for play iframes', () => {
    assert.equal(getGameEmbedPath('brickbreaking'), '/embeds/brickbreaking/index.html');
    assert.equal(getGameEmbedPath('minibrick'), '/embeds/minibrick/index.html');
    assert.equal(getGameEmbedPath('bricks-match'), '/embeds/bricks-match/index.html');
    assert.equal(getGameEmbedPath('brick-invasion'), '/embeds/brick-invasion/index.html');
    assert.equal(getGameEmbedPath('ricorail'), '/embeds/ricorail/index.html');
    assert.equal(getGame('brickbreaking')?.embedPath, '/embeds/brickbreaking/index.html');
  });

  it('exposes game thumbnail URLs', () => {
    assert.equal(getGame('brickbreaking')?.thumbnail, '/embeds/brickbreaking/thumbnail.png');
    assert.equal(getGame('minibrick')?.thumbnail, '/embeds/minibrick/thumbnail.png');
    assert.equal(getGame('bricks-match')?.thumbnail, '/embeds/bricks-match/thumbnail.png');
    assert.equal(getGame('brick-invasion')?.thumbnail, '/embeds/brick-invasion/thumbnail.png');
    assert.equal(getGame('ricorail')?.thumbnail, '/embeds/ricorail/thumbnail.png');
  });

  it('returns null for unknown slug', () => {
    assert.equal(getGameEmbedPath('unknown'), null);
  });
});
