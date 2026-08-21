import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankRelatedCandidates, tagOverlapScore } from './related-posts';

describe('tagOverlapScore', () => {
  it('counts case-insensitive overlap', () => {
    assert.equal(tagOverlapScore(['AI', 'Next'], ['ai', 'React']), 1);
  });
});

describe('rankRelatedCandidates', () => {
  it('prefers higher tag overlap then newer', () => {
    const ranked = rankRelatedCandidates(
      ['ai', 'lab'],
      [
        { id: 'a', tags: ['gossip'], createdAt: '2026-08-20T00:00:00.000Z' },
        { id: 'b', tags: ['ai'], createdAt: '2026-08-10T00:00:00.000Z' },
        { id: 'c', tags: ['ai', 'lab'], createdAt: '2026-08-01T00:00:00.000Z' },
        { id: 'd', tags: ['ai'], createdAt: '2026-08-21T00:00:00.000Z' },
      ],
      3
    );
    assert.deepEqual(
      ranked.map((r) => r.id),
      ['c', 'd', 'b']
    );
  });
});
