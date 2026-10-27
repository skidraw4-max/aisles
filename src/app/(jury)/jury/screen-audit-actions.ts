'use server';
/** I-063: 화면 심사 실행 / I-064: 재심사 (same flow with parentAuditId). Server action; page maxDuration is 300s. */
import { revalidatePath } from 'next/cache';
import { getJuryActor } from '@/lib/jury-product/session';
import { resolveEnvKeyProvider } from '@/lib/jury-product/services/readonly-account/key-provider';

export type ScreenAuditActionResult = { ok: true; status: string; findings: number } | { ok: false; reason: string } | null;

export async function runScreenAuditAction(_prev: ScreenAuditActionResult, formData: FormData): Promise<ScreenAuditActionResult> {
  const [{ runScreenAudit, createPrismaScreenAuditStore }, { createPrismaObservationRunStore }, { createServerlessObservationDriver }, { createSupabaseScreenshotSink }] = await Promise.all([
    import('@/lib/jury-product/services/screen-audit/audit-run'),
    import('@/lib/jury-product/services/readonly-account/observation-run'),
    import('@/lib/jury-product/services/readonly-account/browser-runtime'),
    import('@/lib/jury-product/services/screen-audit/screenshot-store'),
  ]);
  try {
    const actor = await getJuryActor();
    // I-073: ownership gate (only for connections created after JURY_OWNERSHIP_ENFORCE_FROM; off by default).
    const { enforceOwnershipGate } = await import('@/lib/jury-product/services/ownership/enforce');
    const gate = await enforceOwnershipGate({ actor, connectionId: String(formData.get('connectionId') ?? '') });
    if (!gate.allowed) return { ok: false, reason: gate.reason };
    const result = await runScreenAudit({
      actor,
      connectionId: String(formData.get('connectionId') ?? ''),
      parentAuditId: String(formData.get('parentAuditId') ?? '') || null,
      observationStore: await createPrismaObservationRunStore(),
      auditStore: await createPrismaScreenAuditStore(),
      keys: resolveEnvKeyProvider(),
      createDriver: createServerlessObservationDriver,
      createSink: createSupabaseScreenshotSink,
    });
    revalidatePath('/jury/services/[connectionId]', 'page');
    return result.ok ? { ok: true, status: result.status, findings: result.findings } : { ok: false, reason: result.reason };
  } catch {
    return { ok: false, reason: 'ERROR' };
  }
}
