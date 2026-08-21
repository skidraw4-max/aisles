import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUgcWeeklyDigestTag, ugcWeeklyDigestTag } from './week-key';

describe('ugcWeeklyDigestTag', () => {
  it('builds stable tag', () => {
    assert.equal(ugcWeeklyDigestTag('BUILD', '2026-W34'), 'ugc-weekly:BUILD:2026-W34');
    assert.equal(ugcWeeklyDigestTag('LAUNCH', '2026-W34'), 'ugc-weekly:LAUNCH:2026-W34');
  });
});

describe('parseUgcWeeklyDigestTag', () => {
  it('parses valid tags', () => {
    assert.deepEqual(parseUgcWeeklyDigestTag('ugc-weekly:BUILD:2026-W34'), {
      category: 'BUILD',
      weekKey: '2026-W34',
    });
  });

  it('rejects invalid', () => {
    assert.equal(parseUgcWeeklyDigestTag('weekly-build'), null);
  });
});
