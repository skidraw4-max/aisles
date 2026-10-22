/**
 * Run: node --import tsx --test src/lib/seo-robots.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Metadata } from 'next';
import {
  SEO_ROBOTS_NOINDEX_FOLLOW,
  SEO_ROBOTS_PRIVATE,
  SEO_ROBOTS_PUBLIC,
} from './seo-robots';

type RobotsObject = Exclude<NonNullable<Metadata['robots']>, string>;

function asRobotsObject(value: NonNullable<Metadata['robots']>): RobotsObject {
  assert.ok(value && typeof value === 'object');
  return value as RobotsObject;
}

describe('SEO robots presets', () => {
  it('PUBLIC allows index+follow', () => {
    const robots = asRobotsObject(SEO_ROBOTS_PUBLIC);
    assert.equal(robots.index, true);
    assert.equal(robots.follow, true);
  });

  it('PRIVATE blocks index and follow', () => {
    const robots = asRobotsObject(SEO_ROBOTS_PRIVATE);
    assert.equal(robots.index, false);
    assert.equal(robots.follow, false);
  });

  it('NOINDEX_FOLLOW is for search result pages', () => {
    const robots = asRobotsObject(SEO_ROBOTS_NOINDEX_FOLLOW);
    assert.equal(robots.index, false);
    assert.equal(robots.follow, true);
    const gb = robots.googleBot;
    assert.ok(gb && typeof gb === 'object' && !Array.isArray(gb));
    assert.equal(gb.index, false);
    assert.equal(gb.follow, true);
  });
});
