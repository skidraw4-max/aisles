/**
 * Run: node --import tsx --test src/lib/games-seo.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GAMES_PLAY_ROBOTS_DISALLOW,
  isGamesPathIndexable,
  sitemapPriorityForPostCategory,
} from './games-seo';

describe('isGamesPathIndexable', () => {
  it('allows hub and detail only', () => {
    assert.equal(isGamesPathIndexable('/games'), true);
    assert.equal(isGamesPathIndexable('/games/'), true);
    assert.equal(isGamesPathIndexable('/games/brickbreaking'), true);
    assert.equal(isGamesPathIndexable('/games/minibrick'), true);
    assert.equal(isGamesPathIndexable('/games/bricks-match'), true);
    assert.equal(isGamesPathIndexable('/games/brick-invasion'), true);
    assert.equal(isGamesPathIndexable('/games/ricorail'), true);
  });

  it('blocks play routes', () => {
    assert.equal(isGamesPathIndexable('/games/brickbreaking/play'), false);
    assert.equal(isGamesPathIndexable('/games/minibrick/play'), false);
    assert.equal(isGamesPathIndexable('/games/brickbreaking/play/'), false);
    assert.equal(isGamesPathIndexable('/games/brick-invasion/play'), false);
    assert.equal(isGamesPathIndexable('/games/ricorail/play'), false);
  });
});

describe('GAMES_PLAY_ROBOTS_DISALLOW', () => {
  it('targets play paths without disallowing the whole /games hub', () => {
    assert.equal(GAMES_PLAY_ROBOTS_DISALLOW, '/games/*/play');
    assert.notEqual(GAMES_PLAY_ROBOTS_DISALLOW, '/games');
  });
});

describe('sitemapPriorityForPostCategory', () => {
  it('keeps GOSSIP below default post priority', () => {
    assert.ok(sitemapPriorityForPostCategory('GOSSIP') < sitemapPriorityForPostCategory('BUILD'));
    assert.ok(sitemapPriorityForPostCategory('GOSSIP') < 0.8);
  });
});
