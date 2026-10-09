/**
 * Preview integration tests must classify the database before any fixture write.
 * The returned status is safe to log. Connection strings are not included.
 */
export const PREVIEW_PROJECT_REF = 'gdigogpddwjiofwrcies';
export const PREVIEW_HOST_MARKER = 'aws-0-ap-south-1';
const PRODUCTION_MARKERS = ['pcvyoqbyhfbpevzkwpsf', 'aws-1-ap-south-1'] as const;

export type PreviewDbBlock = 'BLOCKED_PRODUCTION_DB' | 'BLOCKED_PREVIEW_DB';

export type PreviewDbEnv = {
  JURY_PREVIEW_DB?: string;
  DATABASE_URL?: string;
  DIRECT_URL?: string;
};

export function planPreviewDbAccess(
  env: PreviewDbEnv,
  expected: { projectRef: string; hostMarker: string } = {
    projectRef: PREVIEW_PROJECT_REF,
    hostMarker: PREVIEW_HOST_MARKER,
  },
): { ok: true } | { ok: false; status: PreviewDbBlock } {
  const database = env.DATABASE_URL ?? '';
  const direct = env.DIRECT_URL ?? '';
  if (PRODUCTION_MARKERS.some((marker) => database.includes(marker) || direct.includes(marker))) {
    return { ok: false, status: 'BLOCKED_PRODUCTION_DB' };
  }
  if (env.JURY_PREVIEW_DB !== '1') return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  const acceptable = (value: string) => value.includes(expected.projectRef) && value.includes(expected.hostMarker);
  if (!acceptable(database) || !acceptable(direct)) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true };
}

export function previewMigrationGate(failedCount: number): { ok: true } | { ok: false; status: 'BLOCKED_PREVIEW_DB' } {
  if (failedCount !== 0) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true };
}

export async function openPreviewDbTest(
  env: PreviewDbEnv,
  readFailedMigrations: () => Promise<number>,
): Promise<{ ok: true } | { ok: false; status: PreviewDbBlock }> {
  const plan = planPreviewDbAccess(env);
  if (!plan.ok) return plan;
  let failed = 1;
  try {
    failed = await readFailedMigrations();
  } catch {
    return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  }
  return previewMigrationGate(failed);
}

export function selectExactTest(
  source: string,
  requestedName: string,
): { ok: true; pattern: string } | { ok: false; status: 'BLOCKED_PREVIEW_DB' } {
  if (!requestedName || /[|*+?()[\]\\]/.test(requestedName)) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  const names = [...source.matchAll(/\btest\(\s*'([^']+)'/g)].map((match) => match[1] ?? '');
  if (names.filter((name) => name === requestedName).length !== 1) return { ok: false, status: 'BLOCKED_PREVIEW_DB' };
  return { ok: true, pattern: `^${requestedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` };
}

export function guardTestDatabase(env: NodeJS.ProcessEnv): void {
  if (!env.NODE_TEST_CONTEXT) return;
  const gate = planPreviewDbAccess({
    JURY_PREVIEW_DB: env.JURY_PREVIEW_DB,
    DATABASE_URL: env.DATABASE_URL,
    DIRECT_URL: env.DIRECT_URL,
  });
  if (!gate.ok) throw new Error(gate.status);
}
