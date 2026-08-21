import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSearchCorridor } from './search-corridor';

describe('parseSearchCorridor', () => {
  it('accepts LAB and AI_FORTUNE', () => {
    assert.equal(parseSearchCorridor('lab'), 'LAB');
    assert.equal(parseSearchCorridor('AI_FORTUNE'), 'AI_FORTUNE');
  });

  it('rejects GOSSIP and junk', () => {
    assert.equal(parseSearchCorridor('GOSSIP'), undefined);
    assert.equal(parseSearchCorridor('xyz'), undefined);
  });
});

describe('searchCorridorToCategory', () => {
  it('maps LAB to RECIPE', async () => {
    const { searchCorridorToCategory } = await import('./search-corridor');
    assert.equal(searchCorridorToCategory('LAB'), 'RECIPE');
    assert.equal(searchCorridorToCategory('BUILD'), 'BUILD');
  });
});
