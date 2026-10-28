/**
 * I-099: "이 결과로 위원 심사하기" — one click from a finished 화면 심사 to the Jury review.
 * Pure helpers (no DB writes): the audit identity that joins the evidence hash, the eligibility rule for the button,
 * and the 3-step progress model. No model call happens here.
 */
import { createHash } from 'node:crypto';

export type ScreenAuditIdentity = { auditId: string; finishedAt: string | null; hash: string };

/** apiEvidence entry that binds an evidence row to the audit it was built from (no migration: existing Json column). */
export const SCREEN_AUDIT_EVIDENCE_ENDPOINT = 'screenAuditIdentity';
const REF_PREFIX = 'screen-audit:';

type IdentityFinding = { rule: string; viewport: unknown; severity: unknown; message: string; path?: string | null; page?: { path: string | null } | null };

export function screenAuditIdentity(audit: { id: string; finishedAt: Date | string | null }, findings: readonly IdentityFinding[]): ScreenAuditIdentity {
  const finishedAt = audit.finishedAt == null ? null : audit.finishedAt instanceof Date ? audit.finishedAt.toISOString() : String(audit.finishedAt);
  const lines = findings
    .map((f) => [f.rule, String(f.viewport), f.path ?? f.page?.path ?? '', String(f.severity), f.message].join('|'))
    .sort();
  const hash = createHash('sha256').update([audit.id, finishedAt ?? '', ...lines].join('\n')).digest('hex');
  return { auditId: audit.id, finishedAt, hash };
}

export function screenAuditApiEvidence(identity: ScreenAuditIdentity): { endpoint: string; payloadRef: string; requestedAt: string } {
  return {
    endpoint: SCREEN_AUDIT_EVIDENCE_ENDPOINT,
    payloadRef: `${REF_PREFIX}${identity.auditId}:${identity.hash}`,
    requestedAt: identity.finishedAt ?? '',
  };
}

/** Audit id bound to an evidence row, or null for evidence collected before I-099 (those keep the latest-DONE rule). */
export function boundScreenAuditId(apiEvidence: unknown): string | null {
  if (!Array.isArray(apiEvidence)) return null;
  for (const item of apiEvidence) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { endpoint?: unknown; payloadRef?: unknown };
    if (row.endpoint !== SCREEN_AUDIT_EVIDENCE_ENDPOINT || typeof row.payloadRef !== 'string') continue;
    const m = row.payloadRef.match(/^screen-audit:([^:]+):[a-f0-9]{64}$/);
    if (m) return m[1];
  }
  return null;
}

type IdentityDb = {
  juryVisualAudit: { findFirst(args: unknown): Promise<{ id: string; finishedAt: Date | null } | null> };
  juryAuditFinding: { findMany(args: unknown): Promise<IdentityFinding[]> };
};

/** Latest DONE audit identity (same audit the I-093 judge input uses). Best-effort: null on any failure. */
export async function loadLatestScreenAuditIdentity(db: unknown, tenantId: string, connectionId: string): Promise<ScreenAuditIdentity | null> {
  try {
    const prisma = db as IdentityDb;
    if (!prisma?.juryVisualAudit?.findFirst || !prisma?.juryAuditFinding?.findMany) return null;
    const audit = await prisma.juryVisualAudit.findFirst({
      where: { tenantId, connectionId, state: 'DONE' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, finishedAt: true },
    });
    if (!audit) return null;
    const rows = await prisma.juryAuditFinding.findMany({
      where: { tenantId, auditId: audit.id },
      select: { rule: true, viewport: true, severity: true, message: true, page: { select: { path: true } } },
      take: 100,
    });
    return screenAuditIdentity(audit, rows);
  } catch {
    return null;
  }
}

export type AuditJuryBlock = 'NO_AUDIT' | 'AUDIT_RUNNING' | 'NO_MEASURED_PAGES' | 'REVIEW_RUNNING' | 'NOT_PERMITTED';

export const AUDIT_JURY_BLOCK_TEXT: Record<AuditJuryBlock, string> = {
  NO_AUDIT: '화면 심사가 끝나면 위원 심사를 할 수 있어요.',
  AUDIT_RUNNING: '화면 심사가 끝나면 위원 심사를 할 수 있어요.',
  NO_MEASURED_PAGES: '모든 화면이 오류 화면·차단·확인 못 함이라 위원 심사에 쓸 화면 근거가 없어요. 원인을 해결하고 새로 심사해 주세요.',
  REVIEW_RUNNING: '진행 중인 위원 심사가 있어요. 끝나면 결과를 확인하세요.',
  NOT_PERMITTED: '현재 역할·서비스 권한으로는 위원 심사를 시작할 수 없어요.',
};

/** Page statuses that count as measured (NOT_TESTED / BLOCKED / ERROR and error screens never do). */
const MEASURED = new Set(['PASS', 'FAIL', 'PARTIAL']);

export function auditJuryEligibility(input: {
  audit: { state: string; status: string | null } | null;
  pages: readonly { path: string; viewport: string; status: string }[];
  errorScreens: readonly { path: string; viewport: string }[];
  reviewRunning: boolean;
  permitted: boolean;
}): { ok: true } | { ok: false; reason: AuditJuryBlock; text: string } {
  const block = (reason: AuditJuryBlock) => ({ ok: false as const, reason, text: AUDIT_JURY_BLOCK_TEXT[reason] });
  if (!input.audit) return block('NO_AUDIT');
  if (input.audit.state !== 'DONE') return block('AUDIT_RUNNING');
  if (!input.permitted) return block('NOT_PERMITTED');
  if (input.reviewRunning) return block('REVIEW_RUNNING');
  const errored = new Set(input.errorScreens.map((e) => `${e.viewport}|${e.path}`));
  const measured = input.pages.some((p) => MEASURED.has(p.status) && !errored.has(`${p.viewport}|${p.path}`));
  if (!measured) return block('NO_MEASURED_PAGES');
  return { ok: true };
}

export const AUDIT_JURY_STEPS = ['화면 심사', '위원 심사', '개선 제안'] as const;
export type AuditJuryPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';

/** Step states for the 3-step progress row. 화면 심사 is already finished when the button is shown. */
export function auditJurySteps(phase: AuditJuryPhase): { label: (typeof AUDIT_JURY_STEPS)[number]; state: 'done' | 'active' | 'todo' | 'failed' }[] {
  const review = phase === 'done' ? 'done' : phase === 'failed' ? 'failed' : phase === 'idle' ? 'todo' : 'active';
  const proposals = phase === 'done' ? 'done' : 'todo';
  return [
    { label: '화면 심사', state: 'done' },
    { label: '위원 심사', state: review },
    { label: '개선 제안', state: proposals },
  ];
}

export const AUDIT_JURY_RESULT_ANCHOR = 'improvement-proposals';
export function auditJuryResultHref(resultId: string): string {
  return `/jury/reviews/${resultId}#${AUDIT_JURY_RESULT_ANCHOR}`;
}

/** Poll result → phase. RUNNING past the I-048 stale window (330s) is reported as failed so the user can retry. */
export type AuditJuryPoll =
  | { state: 'RUNNING'; elapsedMs: number }
  | { state: 'COMPLETED'; resultId: string }
  | { state: 'FAILED'; reason: string }
  | { state: 'NOT_FOUND' };
