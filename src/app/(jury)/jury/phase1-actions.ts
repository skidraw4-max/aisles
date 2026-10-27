'use server';
/**
 * I-072~I-075: server actions for site ownership verification and GA4 viewer connection.
 * Both return NOT_ENABLED unless their env flags are on (default off), so nothing changes until activation.
 */
import { revalidatePath } from 'next/cache';
import { getJuryActor } from '@/lib/jury-product/session';
import { ga4ViewerFlags, ownershipFlags } from '@/lib/jury-product/services/phase1-flags';

export type OwnershipIssueResult = { ok: true; method: string; where: string; value: string; host: string } | { ok: false; reason: string } | null;
export type OwnershipVerifyActionResult = { ok: true; status: string; failureCode: string | null } | { ok: false; reason: string } | null;
export type Ga4ConnectActionResult = { ok: true; propertyId: string } | { ok: false; reason: string } | null;

function pepper(): string | null {
  return process.env.JURY_OWNERSHIP_TOKEN_PEPPER ?? null;
}

export async function issueOwnershipTokenAction(_prev: OwnershipIssueResult, formData: FormData): Promise<OwnershipIssueResult> {
  if (!ownershipFlags().ui) return { ok: false, reason: 'NOT_ENABLED' };
  const { issueOwnershipToken, createPrismaOwnershipStore } = await import('@/lib/jury-product/services/ownership/service');
  const connectionId = String(formData.get('connectionId') ?? '');
  const result = await issueOwnershipToken({
    actor: await getJuryActor(),
    connectionId,
    host: String(formData.get('host') ?? ''),
    method: String(formData.get('method') ?? ''),
    accepted: formData.get('consent') === 'on',
    store: await createPrismaOwnershipStore(),
    pepper: pepper(),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath(`/jury/services/${connectionId}`);
  return { ok: true, method: result.instructions.method, where: result.instructions.where, value: result.instructions.value, host: result.host };
}

export async function verifyOwnershipAction(_prev: OwnershipVerifyActionResult, formData: FormData): Promise<OwnershipVerifyActionResult> {
  if (!ownershipFlags().ui) return { ok: false, reason: 'NOT_ENABLED' };
  const { verifyOwnershipNow, createPrismaOwnershipStore } = await import('@/lib/jury-product/services/ownership/service');
  const connectionId = String(formData.get('connectionId') ?? '');
  const result = await verifyOwnershipNow({
    actor: await getJuryActor(),
    connectionId,
    verificationId: String(formData.get('verificationId') ?? ''),
    store: await createPrismaOwnershipStore(),
    pepper: pepper(),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath(`/jury/services/${connectionId}`);
  return { ok: true, status: result.status, failureCode: result.failureCode };
}

export async function connectGa4ViewerAction(_prev: Ga4ConnectActionResult, formData: FormData): Promise<Ga4ConnectActionResult> {
  if (!ga4ViewerFlags().enabled) return { ok: false, reason: 'NOT_ENABLED' };
  const { connectGa4Viewer, createPrismaGa4ViewerStore } = await import('@/lib/jury-product/services/ga4-viewer/service');
  const connectionId = String(formData.get('connectionId') ?? '');
  const result = await connectGa4Viewer({
    actor: await getJuryActor(),
    connectionId,
    propertyId: String(formData.get('propertyId') ?? ''),
    accepted: formData.get('consent') === 'on',
    store: await createPrismaGa4ViewerStore(),
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  revalidatePath(`/jury/services/${connectionId}`);
  return { ok: true, propertyId: result.propertyId };
}
