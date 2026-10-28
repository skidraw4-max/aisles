/**
 * I-093: reuse the latest finished screen audit (rule-based findings already stored in JuryAuditFinding)
 * as Jury review input. No model call, no new table. Tenant-scoped; best-effort (null on any failure).
 */
import type { JuryScreenAuditEvidence } from '../../../ai-review-board/types';
import { containsSecret } from '../../agent-execution';

export const SCREEN_AUDIT_EVIDENCE_LIMITS = { findings: 20, message: 200 } as const;

type FindingRow = { rule: string; area: string; severity: unknown; status: unknown; viewport: unknown; message: string; page?: { path: string | null } | null };
type AuditDb = {
  juryVisualAudit: { findFirst(args: unknown): Promise<{ id: string; finishedAt: Date | null } | null> };
  juryAuditFinding: { findMany(args: unknown): Promise<FindingRow[]> };
};

export function toScreenAuditEvidence(audit: { id: string; finishedAt: Date | null }, rows: FindingRow[]): JuryScreenAuditEvidence | null {
  const rank = (v: unknown) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>)[String(v)] ?? 3;
  const findings = [...rows].sort((a, b) => rank(a.severity) - rank(b.severity)).slice(0, SCREEN_AUDIT_EVIDENCE_LIMITS.findings).map((f) => ({
    rule: String(f.rule),
    area: String(f.area),
    severity: String(f.severity),
    status: String(f.status),
    viewport: String(f.viewport),
    path: f.page?.path ?? null,
    message: String(f.message).slice(0, SCREEN_AUDIT_EVIDENCE_LIMITS.message),
  }));
  const out = { auditId: audit.id, finishedAt: audit.finishedAt ? audit.finishedAt.toISOString() : null, findings };
  return containsSecret(out) ? null : out;
}

export async function loadScreenAuditEvidence(db: unknown, tenantId: string, connectionId: string, auditId?: string | null): Promise<JuryScreenAuditEvidence | null> {
  try {
    const prisma = db as AuditDb;
    if (!prisma?.juryVisualAudit?.findFirst || !prisma?.juryAuditFinding?.findMany) return null;
    const audit = await prisma.juryVisualAudit.findFirst({
      where: { tenantId, connectionId, state: 'DONE', ...(auditId ? { id: auditId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, finishedAt: true },
    });
    if (!audit) return null;
    const rows = await prisma.juryAuditFinding.findMany({
      where: { tenantId, auditId: audit.id },
      select: { rule: true, area: true, severity: true, status: true, viewport: true, message: true, page: { select: { path: true } } },
      take: 100,
    });
    return toScreenAuditEvidence(audit, rows);
  } catch {
    return null;
  }
}
