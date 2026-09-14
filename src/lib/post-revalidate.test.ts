/**
 * Run: node --import tsx --test src/lib/post-revalidate.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HOME_CACHE_TAGS, homePathsToRevalidate } from './post-revalidate';

describe('post revalidate helpers', () => {
  it('includes home-page and home-quasar tags so new posts invalidate AI Work', () => {
    assert.ok(HOME_CACHE_TAGS.includes('home-page'));
    assert.ok(HOME_CACHE_TAGS.includes('home-quasar'));
  });

  it('revalidates home and post detail paths', () => {
    const paths = homePathsToRevalidate('abc-123');
    assert.ok(paths.includes('/'));
    assert.ok(paths.includes('/post/abc-123'));
  });
});
