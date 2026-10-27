'use server';
/** I-079: delete (disconnect) a service connection. Tenant and role come from the session only. */
import { revalidatePath } from 'next/cache';
import { getJuryActor } from '@/lib/jury-product/session';

export type ConnectionDeleteActionState = { ok: boolean; message: string; screenshotsPending?: boolean; githubUninstallNeeded?: boolean } | null;

export async function deleteConnectionAction(_prev: ConnectionDeleteActionState, formData: FormData): Promise<ConnectionDeleteActionState> {
  const { deleteServiceConnection, connectionDeleteMessage, createPrismaConnectionDeleteStore } = await import('@/lib/jury-product/services/connection-delete/delete');
  let sink = null;
  try {
    sink = await (await import('@/lib/jury-product/services/screen-audit/screenshot-store')).createSupabaseScreenshotSink();
  } catch {
    sink = null; // Storage unavailable: revocation still happens; screenshots are reported as pending.
  }
  const result = await deleteServiceConnection({
    actor: await getJuryActor(),
    connectionId: String(formData.get('connectionId') ?? ''),
    confirmName: String(formData.get('confirmName') ?? ''),
    clientTenantId: String(formData.get('tenantId') ?? '') || null,
    store: await createPrismaConnectionDeleteStore(),
    sink,
  });
  if (result.ok) {
    revalidatePath('/jury/services');
    revalidatePath('/jury/services/[connectionId]', 'page');
  }
  return {
    ok: result.ok,
    message: connectionDeleteMessage(result),
    ...(result.ok ? { screenshotsPending: result.screenshotsPending, githubUninstallNeeded: result.githubUninstallNeeded } : {}),
  };
}
