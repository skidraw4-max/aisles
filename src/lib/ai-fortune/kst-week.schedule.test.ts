/**
 * Run: node --import tsx --test src/lib/ai-fortune/kst-week.schedule.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  aiFortuneWeekKey,
  isScheduledAiFortuneCronWindow,
  kstMondayDateOfContainingWeek,
} from './kst-week';

describe('kstMondayDateOfContainingWeek', () => {
  it('pins Tuesday catch-up to the same Monday as the weekly publish day', () => {
    // 2026-09-15 Tue 12:00 KST = 2026-09-15 03:00 UTC
    const tue = new Date('2026-09-15T03:00:00.000Z');
    const monday = kstMondayDateOfContainingWeek(tue);
    assert.equal(aiFortuneWeekKey(monday), '2026-09-W2');
    assert.equal(aiFortuneWeekKey(tue), '2026-09-W3');
  });
});

describe('isScheduledAiFortuneCronWindow (catch-up safe)', () => {
  it('rejects Monday before 05:00 KST', () => {
    // Mon 2026-09-14 04:30 KST = Sun 19:30 UTC
    assert.equal(
      isScheduledAiFortuneCronWindow(new Date('2026-09-13T19:30:00.000Z')),
      false
    );
  });

  it('allows Monday at 05:00 KST', () => {
    // Mon 2026-09-14 05:00 KST = Sun 20:00 UTC
    assert.equal(
      isScheduledAiFortuneCronWindow(new Date('2026-09-13T20:00:00.000Z')),
      true
    );
  });

  it('allows delayed Monday afternoon KST', () => {
    // Mon 2026-09-14 15:00 KST = Mon 06:00 UTC
    assert.equal(
      isScheduledAiFortuneCronWindow(new Date('2026-09-14T06:00:00.000Z')),
      true
    );
  });

  it('allows Tuesday catch-up after a missed Monday run', () => {
    // Tue 2026-09-15 05:00 KST = Mon 20:00 UTC
    assert.equal(
      isScheduledAiFortuneCronWindow(new Date('2026-09-14T20:00:00.000Z')),
      true
    );
  });
});
