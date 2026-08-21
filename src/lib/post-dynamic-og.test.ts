/**
 * Run: node --import tsx --test src/lib/post-dynamic-og.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Category } from '@prisma/client';
import { categoryUsesDynamicPostOg, dynamicOgBoardSubtitle } from './post-dynamic-og';

const ELIGIBLE: Category[] = [
  'RECIPE',
  'LOUNGE',
  'BUILD',
  'LAUNCH',
  'AI_FORTUNE',
  'GALLERY',
];

const INELIGIBLE: Category[] = ['GOSSIP', 'TREND'];

describe('categoryUsesDynamicPostOg', () => {
  it('includes LAB, LOUNGE, BUILD, LAUNCH, AI_FORTUNE, GALLERY', () => {
    for (const category of ELIGIBLE) {
      assert.equal(categoryUsesDynamicPostOg(category), true, category);
    }
  });

  it('excludes GOSSIP and TREND', () => {
    for (const category of INELIGIBLE) {
      assert.equal(categoryUsesDynamicPostOg(category), false, category);
    }
  });
});

describe('dynamicOgBoardSubtitle', () => {
  it('returns distinct corridor subtitles for eligible categories', () => {
    const subs = ELIGIBLE.map((c) => dynamicOgBoardSubtitle(c));
    assert.equal(new Set(subs).size, ELIGIBLE.length);
    assert.match(dynamicOgBoardSubtitle('BUILD'), /BUILD|제작/i);
    assert.match(dynamicOgBoardSubtitle('LAUNCH'), /LAUNCH|출시/i);
    assert.match(dynamicOgBoardSubtitle('AI_FORTUNE'), /FORTUNE|운세/i);
    assert.match(dynamicOgBoardSubtitle('GALLERY'), /GALLERY|쇼케이스/i);
  });
});
