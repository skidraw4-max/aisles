/**
 * Run: node --import tsx --test src/lib/games/score-bridge.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AISLE_GAME_SCORE_TYPE,
  isTrustedGameMessageOrigin,
  parseAisleGameScoreMessage,
} from './score-bridge';

describe('parseAisleGameScoreMessage', () => {
  it('accepts stage/endless integer scores', () => {
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

  it('rejects invalid payloads', () => {
    assert.equal(parseAisleGameScoreMessage(null), null);
    assert.equal(parseAisleGameScoreMessage({ type: 'other', mode: 'stage', score: 1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: '', score: 1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: -1 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: 1.5 }), null);
    assert.equal(parseAisleGameScoreMessage({ type: AISLE_GAME_SCORE_TYPE, mode: 'stage', score: 'nope' }), null);
  });
});

describe('isTrustedGameMessageOrigin', () => {
  it('allows exact and www/apex pairs', () => {
    assert.equal(
      isTrustedGameMessageOrigin('https://www.aisleshub.com', 'https://www.aisleshub.com'),
      true
    );
    assert.equal(
      isTrustedGameMessageOrigin('https://aisleshub.com', 'https://www.aisleshub.com'),
      true
    );
    assert.equal(
      isTrustedGameMessageOrigin('https://evil.example', 'https://www.aisleshub.com'),
      false
    );
  });
});
