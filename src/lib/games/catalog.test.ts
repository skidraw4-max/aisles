/**
 * Run: node --import tsx --test src/lib/games/catalog.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GAME_LIST, getGame, getGameEmbedPath } from './catalog';

describe('games catalog embed paths', () => {
  it('lists brickbreaking and minibrick', () => {
    assert.deepEqual(
      GAME_LIST.map((g) => g.slug).sort(),
      ['brickbreaking', 'minibrick'],
    );
  });

  it('exposes same-origin static embed paths for play iframes', () => {
    assert.equal(getGameEmbedPath('brickbreaking'), '/games/brickbreaking/index.html');
    assert.equal(getGameEmbedPath('minibrick'), '/games/minibrick/index.html');
    assert.equal(getGame('brickbreaking')?.embedPath, '/games/brickbreaking/index.html');
  });

  it('exposes game thumbnail URLs', () => {
    assert.equal(getGame('brickbreaking')?.thumbnail, '/games/brickbreaking/thumbnail.png');
    assert.equal(getGame('minibrick')?.thumbnail, '/games/minibrick/thumbnail.png');
  });

  it('returns null for unknown slug', () => {
    assert.equal(getGameEmbedPath('unknown'), null);
  });
});
