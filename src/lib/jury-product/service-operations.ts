/**
 * Reads service operations for the active organization.
 * Client tenant, role, and permission values are ignored.
 */
import type { JuryActor } from './access';
import { readJuryConsole } from './console-view';
import { isJuryStoreUnavailable, loadJuryCatalog } from './jury-db';
import { authorizeJuryServiceFeature } from './service-feature-authorization';
import { listUserServiceGrants } from './service-feature-guard';
import type { ServiceGrantRow } from './service-member-management';
import {
  accessSummary,
  operationCapabilities,
  projectServiceOperation,
  type ServiceOperationModel,
} from './service-operations-status';

type ClientIdentity = {
  tenantId?: string | null;
  organizationId?: string | null;
  actingUserId?: string | null;
  actorRole?: string | null;
  permission?: string | null;
};

export type ServiceOperationsResult =
  | { ok: true; rows: ServiceOperationModel[] }
  | { ok: false; reason: 'UNAUTHENTICATED' | 'NO_MEMBERSHIP' | 'STORE_UNAVAILABLE' };

export type ServiceOperationResult =
  | { ok: true; model: ServiceOperationModel }
  | { ok: false; reason: 'UNAUTHENTICATED' | 'NO_MEMBERSHIP' | 'STORE_UNAVAILABLE' | 'NOT_FOUND' | 'FORBIDDEN' };

function grantsFor(grants: readonly ServiceGrantRow[], connectionId: string, userId: string): ServiceGrantRow[] {
  return grants.filter((grant) => grant.connectionId === connectionId && grant.userId === userId);
}

export async function loadServiceOperations(actor: JuryActor, client: ClientIdentity = {}): Promise<ServiceOperationsResult> {
  void client.tenantId;
  void client.organizationId;
  void client.actingUserId;
  void client.actorRole;
  void client.permission;
  if (!actor.ok) return { ok: false, reason: actor.reason === 'UNAUTHENTICATED' ? 'UNAUTHENTICATED' : actor.reason === 'STORE_UNAVAILABLE' ? 'STORE_UNAVAILABLE' : 'NO_MEMBERSHIP' };
  try {
    const catalog = await loadJuryCatalog(actor.tenantId);
    const view = readJuryConsole(actor, catalog);
    if (!view) return { ok: false, reason: 'NO_MEMBERSHIP' };
    const grants = await listUserServiceGrants(actor.tenantId, actor.userId);
    const now = new Date().toISOString();
    const rows = view.connections.flatMap((connection) => {
      const allowed = authorizeJuryServiceFeature({
        actor,
        membership: { tenantId: actor.tenantId, userId: actor.userId },
        connection,
        grants,
        feature: 'service.read',
        clientTenantId: client.tenantId,
        actingUserId: client.actingUserId,
        actorRole: client.actorRole,
        permission: client.permission,
      });
      if (!allowed.ok) return [];
      const model = projectServiceOperation(
        view,
        connection.id,
        operationCapabilities({
          actor,
          connection,
          grants,
          clientTenantId: client.tenantId,
          actingUserId: client.actingUserId,
          actorRole: client.actorRole,
          permission: client.permission,
        }),
        accessSummary(actor.role, grantsFor(grants, connection.id, actor.userId)),
        now,
      );
      return model ? [model] : [];
    });
    return { ok: true, rows };
  } catch (error) {
    if (isJuryStoreUnavailable(error)) return { ok: false, reason: 'STORE_UNAVAILABLE' };
    throw error;
  }
}

export async function loadServiceOperation(
  actor: JuryActor,
  connectionId: string,
  client: ClientIdentity = {},
): Promise<ServiceOperationResult> {
  void client.tenantId;
  void client.organizationId;
  const list = await loadServiceOperations(actor, client);
  if (!list.ok) return list;
  const model = list.rows.find((row) => row.connectionId === connectionId);
  if (model) return { ok: true, model };
  if (!actor.ok) return { ok: false, reason: 'UNAUTHENTICATED' };
  try {
    const catalog = await loadJuryCatalog(actor.tenantId);
    const connection = catalog.connections.find((row) => row.id === connectionId) ?? null;
    if (!connection) return { ok: false, reason: 'NOT_FOUND' };
    const grants = await listUserServiceGrants(actor.tenantId, actor.userId);
    const allowed = authorizeJuryServiceFeature({
      actor,
      membership: { tenantId: actor.tenantId, userId: actor.userId },
      connection,
      grants,
      feature: 'service.read',
      clientTenantId: client.tenantId,
      actingUserId: client.actingUserId,
      actorRole: client.actorRole,
      permission: client.permission,
    });
    return { ok: false, reason: allowed.ok ? 'NOT_FOUND' : allowed.reason === 'TENANT_MISMATCH' ? 'NOT_FOUND' : allowed.reason };
  } catch (error) {
    if (isJuryStoreUnavailable(error)) return { ok: false, reason: 'STORE_UNAVAILABLE' };
    throw error;
  }
}
