/**
 * Run: node --import tsx --test src/lib/corridor-seo-meta.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Category } from '@prisma/client';
import { getCorridorSeoMeta } from './corridor-seo-meta';

const CRAWLABLE: Category[] = [
  'RECIPE',
  'GALLERY',
  'LOUNGE',
  'GOSSIP',
  'BUILD',
  'LAUNCH',
  'AI_FORTUNE',
];

describe('getCorridorSeoMeta', () => {
  it('returns unique title+description for each crawlable corridor', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const category of CRAWLABLE) {
      const meta = getCorridorSeoMeta(category);
      assert.ok(meta, `expected meta for ${category}`);
      assert.ok(meta.title.includes('AIsle') || meta.title.length > 8, category);
      assert.ok(meta.description.length >= 40, `${category} description too short`);
      titles.add(meta.title);
      descriptions.add(meta.description);
    }
    assert.equal(titles.size, CRAWLABLE.length, 'titles must be unique per corridor');
    assert.equal(descriptions.size, CRAWLABLE.length, 'descriptions must be unique per corridor');
  });

  it('uses AI FORTUNE-quality copy for AI_FORTUNE', () => {
    const meta = getCorridorSeoMeta('AI_FORTUNE');
    assert.ok(meta);
    assert.match(meta.title, /AI FORTUNE/i);
    assert.match(meta.description, /운세|커리어|MBTI/i);
  });

  it('maps RECIPE to LAB-oriented copy', () => {
    const meta = getCorridorSeoMeta('RECIPE');
    assert.ok(meta);
    assert.match(meta.title, /LAB|연구소|프롬프트/i);
  });
});
