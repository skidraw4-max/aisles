import { NextRequest, NextResponse } from 'next/server';
import { isJuryAction, planJuryCommand } from '@/lib/jury-product/access';
import { readJuryConsole } from '@/lib/jury-product/console-view';
import { findResourceTenant, isJuryStoreUnavailable, loadJuryCatalog } from '@/lib/jury-product/jury-db';
import { getJuryActor } from '@/lib/jury-product/session';

function statusFor(reason: string): number {
  if (reason === 'UNAUTHENTICATED') return 401;
  if (reason === 'AMBIGUOUS_MEMBERSHIP') return 409;
  if (reason === 'STORE_UNAVAILABLE') return 503;
  if (reason === 'NOT_IMPLEMENTED') return 501;
  return 403;
}

export async function GET(req: NextRequest) {
  const actor = await getJuryActor(req.nextUrl.searchParams.get('tenantId'));
  if (!actor.ok) {
    return NextResponse.json({ ok: false, reason: actor.reason }, { status: statusFor(actor.reason) });
  }
  try {
    const catalog = await loadJuryCatalog(actor.tenantId);
    const view = readJuryConsole(actor, catalog);
    return NextResponse.json({
      ok: true,
      tenantId: actor.tenantId,
      role: actor.role,
      reviewIds: view?.results.map((row) => row.id) ?? [],
    });
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return NextResponse.json({ ok: false, reason: 'STORE_UNAVAILABLE' }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { action?: unknown; tenantId?: unknown; resourceId?: unknown } | null;
  const clientTenantId = typeof body?.tenantId === 'string' ? body.tenantId : null;
  const actor = await getJuryActor(clientTenantId);
  const actionName = typeof body?.action === 'string' ? body.action : '';
  if (!isJuryAction(actionName)) {
    return NextResponse.json({ ok: false, reason: 'FORBIDDEN' }, { status: 403 });
  }
  const resourceId = typeof body?.resourceId === 'string' ? body.resourceId : '';
  let resourceTenantId = '';
  try {
    resourceTenantId = resourceId
      ? actor.ok
        ? ((await findResourceTenant(actor.tenantId, resourceId)) ?? '')
        : ''
      : actor.ok
        ? actor.tenantId
        : '';
  } catch (error) {
    if (isJuryStoreUnavailable(error)) {
      return NextResponse.json({ ok: false, reason: 'STORE_UNAVAILABLE' }, { status: 503 });
    }
    throw error;
  }
  const planned = planJuryCommand({
    actor,
    action: actionName,
    resourceTenantId,
    clientTenantId,
  });
  if (!planned.ok) {
    return NextResponse.json({ ok: false, reason: planned.reason }, { status: statusFor(planned.reason) });
  }
  return NextResponse.json({ ok: true, tenantId: actor.ok ? actor.tenantId : null });
}
