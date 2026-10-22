/**
 * Run snapshot root stays on data/jury-product locally and moves under os.tmpdir() on Vercel.
 * Run: node --import tsx --test src/lib/ai-review-board/store.test.ts
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ReviewBoardRun } from './types';
import { loadRun, resolveRunRoot, saveRunSnapshot } from './store';

const PRODUCT_ROOT = 'data/jury-product';

function snapshot(runId: string): ReviewBoardRun {
  return {
    runId,
    status: 'queued',
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    evidence: null,
    independent: [],
    debate: [],
    critic: null,
    final: null,
    budget: { maxCalls: 1, usedCalls: 0, estimatedCostUsd: 0, warnings: [] },
  };
}

async function withVercel<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const previous = process.env.VERCEL;
  if (value === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = value;
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
}

test('vercel run snapshots are written under the temp jury directory', async () => {
  const runId = `run-vercel-root-${Date.now()}`;
  const repoFile = path.join(process.cwd(), PRODUCT_ROOT, runId, 'run.json');
  const tempFile = path.join(os.tmpdir(), 'jury-product', runId, 'run.json');
  await withVercel('1', async () => {
    const root = resolveRunRoot(PRODUCT_ROOT);
    assert.equal(root, path.join(os.tmpdir(), 'jury-product'));
    assert.equal(root.startsWith(os.tmpdir()), true);
    assert.equal(root.replace(/\\/g, '/').endsWith('data/jury-product'), false);
    await saveRunSnapshot(PRODUCT_ROOT, snapshot(runId));
    assert.equal(existsSync(tempFile), true);
    assert.equal(existsSync(repoFile), false);
    const loaded = await loadRun(PRODUCT_ROOT, runId);
    assert.equal(loaded?.runId, runId);
    assert.equal(resolveRunRoot(path.join(os.tmpdir(), 'custom-board-root')), path.join(os.tmpdir(), 'custom-board-root'));
  });
  await rm(path.join(os.tmpdir(), 'jury-product', runId), { recursive: true, force: true });
  assert.equal(existsSync(repoFile), false);
});

test('non-vercel run snapshots stay under data/jury-product', async () => {
  const runId = `run-local-root-${Date.now()}`;
  const repoDir = path.join(process.cwd(), PRODUCT_ROOT, runId);
  const repoFile = path.join(repoDir, 'run.json');
  await withVercel(undefined, async () => {
    assert.equal(resolveRunRoot(PRODUCT_ROOT), PRODUCT_ROOT);
    await saveRunSnapshot(PRODUCT_ROOT, snapshot(runId));
    assert.equal(existsSync(repoFile), true);
    const loaded = await loadRun(PRODUCT_ROOT, runId);
    assert.equal(loaded?.runId, runId);
  });
  await rm(repoDir, { recursive: true, force: true });
});
