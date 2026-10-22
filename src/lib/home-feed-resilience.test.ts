/**
 * Run: node --import tsx --test src/lib/home-feed-resilience.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FEED_CONTENT_SNIPPET_MAX,
  clipHomeFeedContent,
  shouldClientRetryEmptyFeed,
} from './home-feed-resilience';

describe('shouldClientRetryEmptyFeed', () => {
  it('retries once when SSR/client posts are empty', () => {
    assert.equal(shouldClientRetryEmptyFeed({ postsLength: 0, alreadyRetried: false }), true);
  });

  it('does not retry after one attempt', () => {
    assert.equal(shouldClientRetryEmptyFeed({ postsLength: 0, alreadyRetried: true }), false);
  });

  it('does not retry when posts already exist', () => {
    assert.equal(shouldClientRetryEmptyFeed({ postsLength: 3, alreadyRetried: false }), false);
  });
});

describe('clipHomeFeedContent', () => {
  it('returns null for empty content', () => {
    assert.equal(clipHomeFeedContent(null), null);
    assert.equal(clipHomeFeedContent(''), null);
    assert.equal(clipHomeFeedContent('   '), null);
  });

  it('keeps short content unchanged', () => {
    assert.equal(clipHomeFeedContent('짧은 본문'), '짧은 본문');
  });

  it('clips long content to snippet max with ellipsis', () => {
    const long = '가'.repeat(FEED_CONTENT_SNIPPET_MAX + 40);
    const clipped = clipHomeFeedContent(long);
    assert.ok(clipped);
    assert.equal(clipped.length, FEED_CONTENT_SNIPPET_MAX + 1);
    assert.ok(clipped.endsWith('…'));
    assert.equal(clipped.slice(0, FEED_CONTENT_SNIPPET_MAX), '가'.repeat(FEED_CONTENT_SNIPPET_MAX));
  });
});
