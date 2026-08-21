/**
 * Run: node --import tsx --test src/lib/games/ranking.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  OVERALL_WEEK_KEY,
  assignRanks,
  defaultMode,
  isoWeekKey,
  isValidMode,
  modesForGame,
  parseScoreSubmit,
  weekKeyForPeriod,
} from './ranking';

describe('games ranking helpers', () => {
  it('exposes modes per registered game', () => {
    assert.deepEqual([...modesForGame('brickbreaking')], ['stage', 'infinite']);
    assert.deepEqual([...modesForGame('minibrick')], ['normal', 'endless']);
    assert.deepEqual([...modesForGame('bricks-match')], ['stage', 'endless']);
    assert.equal(defaultMode('brickbreaking'), 'stage');
    assert.equal(defaultMode('minibrick'), 'normal');
    assert.equal(defaultMode('bricks-match'), 'stage');
  });

  it('validates modes per game', () => {
    assert.equal(isValidMode('brickbreaking', 'stage'), true);
    assert.equal(isValidMode('brickbreaking', 'endless'), false);
    assert.equal(isValidMode('minibrick', 'endless'), true);
    assert.equal(isValidMode('minibrick', 'infinite'), false);
    assert.equal(isValidMode('bricks-match', 'stage'), true);
    assert.equal(isValidMode('bricks-match', 'endless'), true);
    assert.equal(isValidMode('bricks-match', 'infinite'), false);
  });

  it('builds ISO week keys and overall sentinel', () => {
    // Known: 2026-07-15 UTC is Wednesday of ISO week 29
    assert.equal(isoWeekKey(new Date(Date.UTC(2026, 6, 15))), '2026-W29');
    assert.equal(weekKeyForPeriod('overall'), OVERALL_WEEK_KEY);
    assert.equal(weekKeyForPeriod('weekly', new Date(Date.UTC(2026, 6, 15))), '2026-W29');
  });

  it('assigns 1-based ranks in list order', () => {
    const ranked = assignRanks([
      { userId: 'a', username: 'A', score: 100 },
      { userId: 'b', username: 'B', score: 50 },
    ]);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.rank, 2);
  });

  it('parses score submit payloads', () => {
    assert.deepEqual(parseScoreSubmit({ mode: 'stage', score: 12 }), { mode: 'stage', score: 12 });
    assert.equal('error' in parseScoreSubmit({ mode: 'stage', score: -1 }), true);
    assert.equal('error' in parseScoreSubmit({ mode: '', score: 1 }), true);
    assert.equal('error' in parseScoreSubmit({ mode: 'stage', score: 1.5 }), true);
  });
});
