/**
 * Authenticated entrance for an explicit GitHub refresh.
 * Identity comes from the actor. Client tenant, user, role, and permission are not inputs.
 * Service membership tables are not read here.
 */
import { decideJuryMutation, type JuryActor } from '../../access';

export type GithubRefreshEntryStop = 'unauthenticated' | 'forbidden' | 'not-found' | 'scope-denied';

export async function runGithubRefreshEntry<T>(input: {
  actor: JuryActor;
  connectionId: string;
  evidenceId: string;
  loadConnection: (query: { connectionId: string; tenantId: string }) => Promise<{ id: string; tenantId: string } | null>;
  loadScopeApproved: (query: { connectionId: string; tenantId: string }) => Promise<boolean>;
  loadEvidence: (query: { evidenceId: string; tenantId: string; connectionId: string }) => Promise<{ id: string; tenantId: string; connectionId: string } | null>;
  start: (args: { tenantId: string; userId: string; connectionId: string; evidenceId: string }) => Promise<T>;
}): Promise<T | { ok: false; flow: GithubRefreshEntryStop }> {
  if (!input.actor.ok) return { ok: false, flow: 'unauthenticated' };
  const allowed = decideJuryMutation({
    actor: input.actor,
    action: 'review.start',
    resourceTenantId: input.actor.tenantId,
    clientTenantId: null,
  });
  if (!allowed.ok) return { ok: false, flow: 'forbidden' };
  const connection = await input.loadConnection({ connectionId: input.connectionId, tenantId: input.actor.tenantId });
  if (!connection || connection.id !== input.connectionId || connection.tenantId !== input.actor.tenantId) {
    return { ok: false, flow: 'not-found' };
  }
  const approved = await input.loadScopeApproved({ connectionId: connection.id, tenantId: input.actor.tenantId });
  if (!approved) return { ok: false, flow: 'scope-denied' };
  const evidence = await input.loadEvidence({
    evidenceId: input.evidenceId,
    tenantId: input.actor.tenantId,
    connectionId: connection.id,
  });
  if (!evidence || evidence.id !== input.evidenceId || evidence.tenantId !== input.actor.tenantId || evidence.connectionId !== connection.id) {
    return { ok: false, flow: 'not-found' };
  }
  return input.start({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    connectionId: connection.id,
    evidenceId: evidence.id,
  });
}
