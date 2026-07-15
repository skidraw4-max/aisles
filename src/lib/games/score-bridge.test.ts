/**
 * Run: node --import tsx --test src/lib/games/score-bridge.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AISLE_GAME_SCORE_TYPE, parseAisleGameScoreMessage } from './score-bridge';

describe('parseAisleGameScoreMessage', () => {
  it('accepts valid aisle-game-score payloads', () => {
    assert.deepEqual(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: 1200 }), {
      type: AISLE_GAME_SCORE_TYPE,
      mode: 'stage',
      score: 1200,
    });
    assert.deepEqual(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'endless', score: 0 }), {
      type: AISLE_GAME_SCORE_TYPE,
      mode: 'endless',
      score: 0,
    });
  });

  it('rejects unrelated or malformed messages', () => {
    assert.equal(parseAisleGameScoreMessage(null), null);
    assert.equal(parseAisleGameScoreMessage({ type: 'other', mode: 'stage', score: 1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: '', score: 1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: -1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: 1.5 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: 'nope' }), null);
  });
});
