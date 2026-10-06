/**
 * Aisle adapter reads through the existing v9.x functions.
 * It returns their EvidencePack unchanged and does not decide tenant or scope.
 */
import { attachGa4Evidence } from '@/lib/ai-review-board/ga4-evidence';
import { buildEvidencePackFromDb, type EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import type { EvidencePack } from '@/lib/ai-review-board/types';
import { isIssuedAccessContext, type JuryAccessContext } from './access-layer';

export const AISLE_ADAPTER_TARGETS = ['buildEvidencePackFromDb', 'attachGa4Evidence'] as const;

export type AisleObservation =
  | {
      ok: true;
      executed: true;
      tenantId: string;
      connectionId: string;
      pack: EvidencePack;
    }
  | { ok: false; reason: 'CONTEXT_NOT_ISSUED' | 'COLLECTION_FAILED' };

function safeFailure(error: unknown, pointer: string): { ok: false; reason: 'COLLECTION_FAILED'; message: string } {
  const raw = error instanceof Error ? error.message : 'COLLECTION_FAILED';
  const message = pointer.length > 0 ? raw.split(pointer).join('[redacted]') : raw;
  return { ok: false, reason: 'COLLECTION_FAILED', message };
}

async function defaultEvidenceDb(): Promise<EvidenceDb> {
  const loaded = await import('@/lib/prisma');
  return loaded.prisma;
}

export async function runAisleAdapter(
  context: JuryAccessContext,
  evidenceDb?: EvidenceDb,
): Promise<AisleObservation> {
  if (!isIssuedAccessContext(context)) return { ok: false, reason: 'CONTEXT_NOT_ISSUED' };
  try {
    const db = evidenceDb ?? (await defaultEvidenceDb());
    const built = await buildEvidencePackFromDb(db);
    const pack = await attachGa4Evidence(built);
    return {
      ok: true,
      executed: true,
      tenantId: context.tenantId,
      connectionId: context.connectionId,
      pack,
    };
  } catch (error) {
    return safeFailure(error, context.credentialRef);
  }
}
