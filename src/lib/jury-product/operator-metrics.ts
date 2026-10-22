/**
 * RM-14 (I-012): 운영자 콘솔 O-지표. Tenant-scoped, read-only, OWNER/ADMIN only.
 * O-001 요청 수, O-002 상태별 건수, O-003 완료율(정수 %, 종료된 요청 기준), O-004 실패 사유,
 * O-008 소요 시간(요청 생성→결과 완료, 중앙값/최대), O-009 모델별 호출 성공/실패.
 * Legacy rows (resultSource=UNKNOWN_LEGACY, pre-RM-01) have no trustworthy createdAt → excluded from O-008.
 */
import type { JuryActor } from './access';

export const OPERATOR_ROLES = ['OWNER', 'ADMIN'] as const;
export const OPERATOR_WINDOW_DAYS = 30;

export type OperatorRequestRow = {
  status: string;
  resultSource: string;
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
};
export type OperatorLlmRow = { model: string | null; provider: string; status: string };

export type OperatorMetrics = {
  windowDays: number;
  total: number;
  byStatus: { status: string; count: number }[];
  completionRate: { value: number | null; note: string };
  failureReasons: { reason: string; count: number }[];
  duration: { measured: number; excludedLegacy: number; medianSec: number | null; maxSec: number | null };
  models: { model: string; ok: number; failed: number }[];
  bySource: { source: string; count: number }[];
};

export function canViewOperatorConsole(actor: JuryActor): boolean {
  return actor.ok && (OPERATOR_ROLES as readonly string[]).includes(actor.role);
}

const tally = <T extends string>(items: readonly T[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function buildOperatorMetrics(requests: readonly OperatorRequestRow[], calls: readonly OperatorLlmRow[]): OperatorMetrics {
  const byStatus = tally(requests.map((r) => r.status)).map(([status, count]) => ({ status, count }));
  const done = requests.filter((r) => r.status === 'COMPLETED').length;
  const failed = requests.filter((r) => r.status === 'FAILED').length;
  const finished = done + failed;
  const completionRate = finished === 0
    ? { value: null, note: '종료된 요청 없음 — 집계 불가' }
    : { value: Math.round((done / finished) * 100), note: `종료 ${finished}건 중 완료 ${done}건` };
  const failureReasons = tally(requests.filter((r) => r.status === 'FAILED').map((r) => r.failureReason ?? '사유 미기록'))
    .map(([reason, count]) => ({ reason, count }));
  const legacy = requests.filter((r) => r.resultSource === 'UNKNOWN_LEGACY').length;
  const secs = requests
    .filter((r) => r.resultSource !== 'UNKNOWN_LEGACY' && r.completedAt)
    .map((r) => Math.max(0, Math.round((r.completedAt!.getTime() - r.createdAt.getTime()) / 1000)))
    .sort((a, b) => a - b);
  const median = secs.length === 0 ? null : secs.length % 2 ? secs[(secs.length - 1) / 2]! : Math.round((secs[secs.length / 2 - 1]! + secs[secs.length / 2]!) / 2);
  const models = new Map<string, { ok: number; failed: number }>();
  for (const c of calls) {
    const key = `${c.provider}/${c.model ?? '모델 미기록'}`;
    const e = models.get(key) ?? { ok: 0, failed: 0 };
    if (c.status === 'OK' || c.status === 'SUCCESS' || c.status === 'COMPLETED') e.ok += 1; else e.failed += 1;
    models.set(key, e);
  }
  return {
    windowDays: OPERATOR_WINDOW_DAYS,
    total: requests.length,
    byStatus,
    completionRate,
    failureReasons,
    duration: { measured: secs.length, excludedLegacy: legacy, medianSec: median, maxSec: secs.length ? secs[secs.length - 1]! : null },
    models: [...models.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => a.model.localeCompare(b.model)),
    bySource: tally(requests.map((r) => r.resultSource)).map(([source, count]) => ({ source, count })),
  };
}

export async function loadOperatorMetrics(actor: JuryActor, now = new Date()): Promise<{ ok: true; metrics: OperatorMetrics } | { ok: false; reason: 'FORBIDDEN' }> {
  if (!actor.ok || !canViewOperatorConsole(actor)) return { ok: false, reason: 'FORBIDDEN' };
  const { prisma } = await import('@/lib/prisma');
  const since = new Date(now.getTime() - OPERATOR_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.juryReviewRequest.findMany({
    where: { tenantId: actor.tenantId, createdAt: { gte: since } },
    select: { tenantId: true, status: true, resultSource: true, failureReason: true, createdAt: true, result: { select: { tenantId: true, completedAt: true } } },
  });
  const calls = await prisma.juryLlmCallLog.findMany({
    where: { tenantId: actor.tenantId, startedAt: { gte: since } },
    select: { tenantId: true, provider: true, model: true, status: true },
  });
  const requests = rows.filter((r) => r.tenantId === actor.tenantId).map((r) => ({
    status: r.status,
    resultSource: r.resultSource,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
    completedAt: r.result?.tenantId === actor.tenantId ? r.result.completedAt : null,
  }));
  return { ok: true, metrics: buildOperatorMetrics(requests, calls.filter((c) => c.tenantId === actor.tenantId)) };
}
