/**
 * RM-03 (CT-11, M-014): request-based status rows for reviews that have no displayable result yet
 * (QUEUED / RUNNING / FAILED, or a stale RUNNING attempt). Display only; never re-runs anything.
 * Missing data is labelled as missing ("기록 없음"), never as "no problem".
 */
import type { JuryConsoleView, JuryReviewAttemptRow } from './console-view';
import { REVIEW_STALE_RUNNING_MS, isStaleRunningReview } from './review-stale';

import { CONNECTED_REVIEW_STALE_TEXT } from './connected-service-copy';

export { CONNECTED_REVIEW_STALE_TEXT };

export const STALE_RUNNING_DEFAULT_MS = 15 * 60 * 1000;

const FAILURE_LABELS: Record<string, string> = {
  REVIEW_NOT_EXECUTED: '심사를 실행하지 못했어요',
  DECISION_NOT_IN_CONTRACT: '결론 값이 계약 범위를 벗어났어요',
  CORE_READING_REJECTED: '심사 결과 형식이 올바르지 않아요',
  PERSISTENCE_FAILED: '결과 저장에 실패했어요',
  REVIEW_ALREADY_EXISTS: '진행 중인 심사가 있어요. 잠시 후 결과를 확인하세요',
};

const LLM_ERROR_LABELS: Record<string, string> = {
  LLM_TIMEOUT: 'AI 호출 시간 초과',
  LLM_BUDGET_EXCEEDED: '전체 실행 시간 한도 초과',
  TIMEOUT: 'AI 호출 시간 초과',
  MISSING_GEMINI_KEY: 'AI 키 설정 없음',
  HTTP_429: 'AI 호출 한도 초과(429)',
};

export type RequestStatusRow = {
  key: string;
  evidenceId: string;
  reviewType: string;
  /** QUEUED | RUNNING | FAILED | STALE (RUNNING with no finish after the stale threshold) */
  state: 'QUEUED' | 'RUNNING' | 'FAILED' | 'STALE';
  stateLabel: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Never empty for FAILED/STALE: an explicit "사유 미기록" is used when nothing was stored. */
  reason: string | null;
  reasonCode: string | null;
  llmErrorCode: string | null;
  attempts: number;
  origin: 'ATTEMPT' | 'REQUEST';
};

export function failureReasonLabel(code: string | null, llmErrorCode: string | null): string {
  const base = code ? FAILURE_LABELS[code] ?? `사유 코드 ${code}` : '사유 미기록';
  const llm = llmErrorCode ? LLM_ERROR_LABELS[llmErrorCode] ?? `AI 호출 오류 ${llmErrorCode}` : null;
  return llm ? `${base} (${llm})` : base;
}

export function buildRequestStatusRows(
  view: Pick<JuryConsoleView, 'requests' | 'results' | 'attempts'>,
  now: number,
  staleMs: number = STALE_RUNNING_DEFAULT_MS,
): RequestStatusRow[] {
  const withResult = new Set(view.results.map((row) => row.reviewRequestId));
  const byKey = new Map<string, JuryReviewAttemptRow[]>();
  for (const attempt of view.attempts ?? []) {
    const list = byKey.get(attempt.reviewRequestKey) ?? [];
    list.push(attempt);
    byKey.set(attempt.reviewRequestKey, list);
  }
  const selfKeys = new Set(view.requests.filter((r) => r.mode === 'AISLE_SELF').map((r) => r.id));
  const rows: RequestStatusRow[] = [];
  for (const [key, list] of byKey) {
    if (withResult.has(key)) continue;
    const latest = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]!;
    if (latest.status === 'COMPLETED') continue;
    let state: RequestStatusRow['state'] = latest.status === 'FAILED' ? 'FAILED' : latest.status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
    const self = selfKeys.has(key);
    const limit = self ? Math.min(staleMs, REVIEW_STALE_RUNNING_MS) : staleMs;
    if (state === 'RUNNING' && !latest.finishedAt && now - Date.parse(latest.startedAt) > limit) state = 'STALE';
    const failed = state === 'FAILED' || state === 'STALE';
    rows.push({
      key,
      evidenceId: latest.evidenceId,
      reviewType: latest.reviewType,
      state,
      stateLabel: STATE_LABELS[state],
      startedAt: latest.startedAt,
      finishedAt: latest.finishedAt,
      reason: failed
        ? state === 'STALE'
          ? self
            ? CONNECTED_REVIEW_STALE_TEXT
            : '완료 기록 없이 중단됨 (시간 초과 추정)'
          : failureReasonLabel(latest.failureReason, latest.lastLlmErrorCode)
        : null,
      reasonCode: latest.failureReason,
      llmErrorCode: latest.lastLlmErrorCode,
      attempts: list.length,
      origin: 'ATTEMPT',
    });
  }
  // Legacy requests without attempts (pre RM-01) that never got a result.
  for (const request of view.requests) {
    if (withResult.has(request.id) || byKey.has(request.id)) continue;
    if (request.status === 'COMPLETED') continue;
    let state: RequestStatusRow['state'] = request.status === 'FAILED' ? 'FAILED' : request.status === 'QUEUED' ? 'QUEUED' : 'RUNNING';
    // I-048: a connected review row orphaned by a killed function has no attempt; detect it from updatedAt.
    const staleSelf = request.mode === 'AISLE_SELF' && isStaleRunningReview(request.status, request.updatedAt ?? null, now);
    if (staleSelf) state = 'STALE';
    rows.push({
      key: request.id,
      evidenceId: request.evidenceId,
      reviewType: request.reviewType,
      state,
      stateLabel: STATE_LABELS[state],
      startedAt: null,
      finishedAt: null,
      reason: staleSelf ? CONNECTED_REVIEW_STALE_TEXT : state === 'FAILED' ? failureReasonLabel(request.failureReason ?? null, null) : null,
      reasonCode: request.failureReason ?? null,
      llmErrorCode: null,
      attempts: 0,
      origin: 'REQUEST',
    });
  }
  return rows.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

const STATE_LABELS: Record<RequestStatusRow['state'], string> = {
  QUEUED: '대기 중',
  RUNNING: '실행 중',
  FAILED: '실패',
  STALE: '응답 없음',
};

/** Loader: latest attempts for the tenant (bounded), with evidence connection for authorization. */
export async function loadReviewAttempts(tenantId: string, limit = 200): Promise<JuryReviewAttemptRow[]> {
  const { prisma } = await import('@/lib/prisma');
  const rows = await prisma.juryReviewAttempt.findMany({
    where: { tenantId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { llmCalls: { where: { status: 'ERROR' }, orderBy: { seq: 'desc' }, take: 1, select: { errorCode: true } } },
  });
  const evidenceIds = [...new Set(rows.map((row) => row.evidenceId))];
  const evidence = evidenceIds.length
    ? await prisma.juryEvidence.findMany({ where: { tenantId, id: { in: evidenceIds } }, select: { id: true, connectionId: true } })
    : [];
  const connectionOf = new Map(evidence.map((row) => [row.id, row.connectionId]));
  return rows
    .filter((row) => row.tenantId === tenantId)
    .map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      reviewRequestKey: row.reviewRequestKey,
      evidenceId: row.evidenceId,
      connectionId: connectionOf.get(row.evidenceId) ?? null,
      reviewType: row.reviewType,
      status: row.status,
      failureReason: row.failureReason,
      resultSource: row.resultSource,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      lastLlmErrorCode: row.llmCalls[0]?.errorCode ?? null,
    }));
}
