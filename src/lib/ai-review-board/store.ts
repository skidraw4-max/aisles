import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { HistoryEvent, ReviewBoardRun } from './types';

export const DEFAULT_REVIEW_BOARD_ROOT = path.join(process.cwd(), 'data', 'ai-review-board');

const JURY_PRODUCT_RUN_ROOT = 'data/jury-product';

function vercelRuntime(): boolean {
  const flag = process.env.VERCEL;
  return flag != null && flag !== '';
}

function isJuryProductRunRoot(root: string): boolean {
  const normalized = path.normalize(root).replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized === JURY_PRODUCT_RUN_ROOT || normalized.endsWith(`/${JURY_PRODUCT_RUN_ROOT}`);
}

/** Logical root stays data/jury-product. Vercel remaps only the physical directory. */
export function resolveRunRoot(root: string): string {
  if (vercelRuntime() && isJuryProductRunRoot(root)) {
    return path.join(os.tmpdir(), 'jury-product');
  }
  return root;
}

export function runDir(root: string, runId: string): string {
  return path.join(resolveRunRoot(root), runId);
}

export async function ensureRunDir(root: string, runId: string): Promise<string> {
  const dir = runDir(root, runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return null;
    throw e;
  }
}

export async function appendHistory(root: string, runId: string, event: HistoryEvent): Promise<void> {
  const dir = await ensureRunDir(root, runId);
  const file = path.join(dir, 'raw-log.jsonl');
  await fs.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
}

export async function saveRunSnapshot(root: string, run: ReviewBoardRun): Promise<void> {
  const dir = await ensureRunDir(root, run.runId);
  if (run.evidence) {
    await writeJson(path.join(dir, 'evidence.json'), run.evidence);
  }
  await writeJson(path.join(dir, 'independent-analysis.json'), run.independent);
  await writeJson(path.join(dir, 'debate.json'), run.debate);
  if (run.claimCalibrations && run.claimCalibrations.length > 0) {
    await writeJson(path.join(dir, 'claim-calibrations.json'), run.claimCalibrations);
  }
  if (run.evidenceSemantics && run.evidenceSemantics.length > 0) {
    await writeJson(path.join(dir, 'evidence-semantics.json'), run.evidenceSemantics);
  }
  if (run.semanticJudgments && run.semanticJudgments.length > 0) {
    await writeJson(path.join(dir, 'semantic-judgments.json'), run.semanticJudgments);
  }
  if (run.revisions && run.revisions.length > 0) {
    await writeJson(path.join(dir, 'revisions.json'), run.revisions);
  }
  if (run.critic) {
    await writeJson(path.join(dir, 'critic.json'), run.critic);
  }
  if (run.final) {
    await writeJson(path.join(dir, 'final.json'), run.final);
  }
  await writeJson(path.join(dir, 'run.json'), run);
}

export async function loadRun(root: string, runId: string): Promise<ReviewBoardRun | null> {
  return readJson<ReviewBoardRun>(path.join(runDir(root, runId), 'run.json'));
}

export async function listRuns(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(resolveRunRoot(root), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return [];
    throw e;
  }
}

export function createRunId(now: Date = new Date()): string {
  const iso = now.toISOString().replace(/[:.]/g, '-');
  return `run-${iso}`;
}
