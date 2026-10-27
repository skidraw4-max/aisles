/**
 * I-073: server-side ownership gate used by observation / screen-audit actions.
 * No DB access at all unless JURY_OWNERSHIP_UI_ENABLED + pepper + JURY_OWNERSHIP_ENFORCE_FROM are set.
 */
import type { JuryActor } from '../../access';
import { ownershipFlags, type EnvLike } from '../phase1-flags';
import { isOwnershipGateApplicable, ownershipGateDecision } from './gate';
import type { OwnershipStore } from './service';
import { hasVerifiedOwnership } from './service';

export async function enforceOwnershipGate(input: {
  actor: JuryActor;
  connectionId: string;
  env?: EnvLike;
  store?: OwnershipStore;
}): Promise<{ allowed: true } | { allowed: false; reason: 'OWNERSHIP_REQUIRED' }> {
  const flags = ownershipFlags(input.env ?? process.env);
  if (!flags.enforceFrom || !input.actor.ok) return { allowed: true };
  const store = input.store ?? (await (await import('./service')).createPrismaOwnershipStore());
  const connection = await store.findConnection(input.actor.tenantId, input.connectionId);
  // Missing connection: let the downstream action return its own NOT_FOUND / FORBIDDEN.
  if (!connection) return { allowed: true };
  const base = { accessMethod: connection.accessMethod, connectionCreatedAt: connection.createdAt, enforceFrom: flags.enforceFrom };
  if (!isOwnershipGateApplicable(base)) return { allowed: true };
  const rows = await store.listForConnection(connection.tenantId, connection.id);
  const decision = ownershipGateDecision({ ...base, verifiedNow: hasVerifiedOwnership(rows) });
  return decision.allowed ? { allowed: true } : decision;
}
