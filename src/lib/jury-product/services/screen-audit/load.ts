/** I-063: tenant-scoped loader for the 화면 심사 tab. Screenshot links are 5-minute signed URLs created server side. */
import type { AuditHeader } from './view-model';

export type ScreenAuditView = {
  latest: (AuditHeader & {
    findings: { id: string; area: string; rule: string; severity: string; status: string; viewport: string; message: string; path: string | null }[];
    shots: { id: string; path: string; viewport: string; url: string | null }[];
    pages: { path: string; viewport: string; status: string }[];
  }) | null;
  history: AuditHeader[];
};

export async function loadScreenAuditView(tenantId: string, connectionId: string): Promise<ScreenAuditView> {
  const { prisma } = await import('@/lib/prisma');
  const history = await prisma.juryVisualAudit.findMany({
    where: { tenantId, connectionId },
    orderBy: { createdAt: 'desc' },
    take: 6,
    select: { id: true, state: true, status: true, createdAt: true, finishedAt: true, parentAuditId: true, summary: true },
  });
  const head = history[0];
  if (!head) return { latest: null, history: [] };
  const [findings, evidence, pages] = await Promise.all([
    prisma.juryAuditFinding.findMany({ where: { tenantId, auditId: head.id }, select: { id: true, area: true, rule: true, severity: true, status: true, viewport: true, message: true, page: { select: { path: true } } }, take: 100 }),
    prisma.juryAuditEvidence.findMany({ where: { tenantId, auditId: head.id, kind: 'SCREENSHOT', deletedAt: null, masked: true }, select: { id: true, storageKey: true, page: { select: { path: true, viewport: true } } }, take: 16 }),
    prisma.juryAuditPage.findMany({ where: { tenantId, auditId: head.id }, select: { path: true, viewport: true, status: true }, take: 100 }),
  ]);
  const { signedScreenshotUrl } = await import('./screenshot-store');
  const shots = await Promise.all(
    evidence.map(async (e) => ({ id: e.id, path: e.page?.path ?? '', viewport: e.page?.viewport ?? '', url: e.storageKey ? await signedScreenshotUrl(e.storageKey).catch(() => null) : null })),
  );
  return {
    latest: { ...head, status: head.status ?? null, findings: findings.map((f) => ({ ...f, status: String(f.status), path: f.page?.path ?? null })), shots, pages: pages.map((p) => ({ ...p, status: String(p.status) })) },
    history: history.slice(1).map((h) => ({ ...h, status: h.status ?? null })),
  };
}
