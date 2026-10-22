/**
 * Run: node --import tsx --test src/lib/loading-scope.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const ROOT = process.cwd();

describe('home loading scope', () => {
  it('does not replace the whole corridor with a hero+tab skeleton on tab switches', () => {
    const loadingPath = path.join(ROOT, 'src/app/(root)/loading.tsx');
    if (!existsSync(loadingPath)) {
      return;
    }
    const src = readFileSync(loadingPath, 'utf8');
    assert.equal(
      src.includes('heroBlock'),
      false,
      '(root)/loading.tsx must not paint a full-page hero skeleton',
    );
    assert.equal(
      src.includes('tabRow'),
      false,
      '(root)/loading.tsx must not replace corridor tabs',
    );
  });

  it('keeps post-detail loading.tsx (segment-scoped, not home tabs)', () => {
    assert.equal(
      existsSync(path.join(ROOT, 'src/app/(root)/post/[id]/loading.tsx')),
      true,
    );
  });
});
