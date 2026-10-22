import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import {
  canStartReviewBoardRun,
  findInProgressRunId,
  isAdminReviewBoardRunAllowed,
  prepareQueuedReviewBoardRun,
} from './start-run';
import { saveRunSnapshot } from './store';
import type { ReviewBoardRun } from './types';
import { createBudget } from './call-budget';

describe('isAdminReviewBoardRunAllowed', () => {
  it('rejects Vercel', () => {
    assert.equal(isAdminReviewBoardRunAllowed({ VERCEL: '1', NODE_ENV: 'development' }), false);
  });

  it('allows local development by default', () => {
    assert.equal(isAdminReviewBoardRunAllowed({ NODE_ENV: 'development' }), true);
  });

  it('rejects production unless explicit allow', () => {
    assert.equal(isAdminReviewBoardRunAllowed({ NODE_ENV: 'production' }), false);
    assert.equal(
      isAdminReviewBoardRunAllowed({ NODE_ENV: 'production', AI_REVIEW_BOARD_ALLOW_ADMIN_RUN: '1' }),
      true,
    );
  });

  it('honors explicit deny', () => {
    assert.equal(
      isAdminReviewBoardRunAllowed({ NODE_ENV: 'development', AI_REVIEW_BOARD_ALLOW_ADMIN_RUN: '0' }),
      false,
    );
  });
});

describe('canStartReviewBoardRun', () => {
  it('blocks when any run is in progress', () => {
    assert.equal(canStartReviewBoardRun(['completed', 'debate']), false);
    assert.equal(canStartReviewBoardRun(['completed', 'failed']), true);
  });
});

describe('findInProgressRunId + prepareQueuedReviewBoardRun', () => {
  const roots: string[] = [];
  after(async () => {
    await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
  });

  it('finds in-progress run and prepare writes snapshot', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'arb-start-'));
    roots.push(root);
    const evidence = buildStubEvidencePack();

    assert.equal(await findInProgressRunId(root), null);

    const queued = await prepareQueuedReviewBoardRun({ rootDir: root, evidence });
    assert.equal(queued.status, 'collecting_evidence');
    assert.equal(await findInProgressRunId(root), queued.runId);

    const completed: ReviewBoardRun = {
      ...queued,
      status: 'completed',
      updatedAt: new Date().toISOString(),
      budget: createBudget(40),
    };
    await saveRunSnapshot(root, completed);
    assert.equal(await findInProgressRunId(root), null);
  });
});
