/**
 * Service access runs the Access Layer before the Aisle adapter.
 * The adapter never receives the caller's tenant id.
 */
import type { EvidenceDb } from '@/lib/ai-review-board/evidence-pack';
import type { JuryActor } from './access';
import { createAccessContext, type AccessConnectionInput, type AccessScopeInput } from './access-layer';
import { runAisleAdapter } from './aisle-adapter';

export async function runAisleServiceAccess(input: {
  actor: JuryActor;
  connection: AccessConnectionInput;
  scope: AccessScopeInput | null;
  clientTenantId?: string | null;
  evidenceDb?: EvidenceDb;
}): Promise<Exclude<ReturnType<typeof createAccessContext>, { ok: true }> | Awaited<ReturnType<typeof runAisleAdapter>>> {
  const issued = createAccessContext(input);
  if (!issued.ok) return issued;
  return runAisleAdapter(issued.context, input.evidenceDb);
}
