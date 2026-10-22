/**
 * RM-10b backfill (dry-run by default).
 *  1. OWNER grants: for every connection, create the service grants planOwnerGrants() would have
 *     created at connection time (tenant OWNERs + creator), skipDuplicates => idempotent.
 *  2. DISCOVERY_PENDING -> CONNECTED for connections with >=1 APPROVED scope, via the same
 *     activatePendingConnection() the app uses (deterministic audit id => idempotent).
 * Everything runs in ONE transaction; counts are printed; dry-run rolls back.
 *
 * Usage: npx tsx scripts/prod-rehearsal/backfill-rm10b.ts [--apply]
 * Non-loopback databases are refused unless JURY_BACKFILL_APPROVED=RM-10b is set (requires JD approval).
 */
import { isIsolatedLocalTestDb } from '../../src/lib/jury-product/preview-db-guard';

const APPLY = process.argv.includes('--apply');
class DryRun extends Error {}

async function main() {
  if (!isIsolatedLocalTestDb(process.env) && process.env.JURY_BACKFILL_APPROVED !== 'RM-10b') {
    throw new Error('REFUSED: non-isolated DB without JURY_BACKFILL_APPROVED=RM-10b');
  }
  const { prisma } = await import('../../src/lib/prisma');
  const { planOwnerGrants } = await import('../../src/lib/jury-product/service-owner-grants');
  const { activatePendingConnection } = await import('../../src/lib/jury-product/console-catalog-scope');
  const now = new Date().toISOString();
  const report = { mode: APPLY ? 'APPLY' : 'DRY_RUN', connections: 0, grantsPlanned: 0, grantsMissing: 0, grantsInserted: 0,
    pendingWithApproved: 0, pendingProposedOnly: 0, activated: 0, details: [] as unknown[] };
  try {
    await prisma.$transaction(async (tx) => {
      const conns = await tx.juryServiceConnection.findMany({ select: { id: true, tenantId: true, status: true, createdByUserId: true } });
      report.connections = conns.length;
      for (const c of conns) {
        const memberships = await tx.juryMembership.findMany({ where: { tenantId: c.tenantId }, select: { tenantId: true, userId: true, role: true } });
        const planned = planOwnerGrants({ tenantId: c.tenantId, connectionId: c.id, creatorUserId: c.createdByUserId, memberships });
        const existing = await tx.juryServiceMember.findMany({ where: { connectionId: c.id, tenantId: c.tenantId }, select: { userId: true, permission: true } });
        const have = new Set(existing.map((e) => `${e.userId}:${e.permission}`));
        const missing = planned.filter((p) => !have.has(`${p.userId}:${p.permission}`));
        report.grantsPlanned += planned.length; report.grantsMissing += missing.length;
        if (missing.length) {
          const r = await tx.juryServiceMember.createMany({ data: missing.map((m) => ({ id: `rm10b:${m.connectionId}:${m.userId}:${m.permission}`, ...m })), skipDuplicates: true });
          report.grantsInserted += r.count;
        }
        const scopes = await tx.juryAccessScope.findMany({ where: { connectionId: c.id, tenantId: c.tenantId }, select: { status: true } });
        let activated = false;
        if (c.status === 'DISCOVERY_PENDING') {
          if (scopes.some((s) => s.status === 'APPROVED')) report.pendingWithApproved++; else report.pendingProposedOnly++;
          activated = await activatePendingConnection(tx, { tenantId: c.tenantId, connectionId: c.id, actorUserId: 'system:backfill-rm10b', now });
          if (activated) report.activated++;
        }
        report.details.push({ connection: c.id.slice(0, 8), status: c.status, scopes: scopes.map((s) => s.status), missingGrants: missing.map((m) => m.permission), activated });
      }
      if (!APPLY) throw new DryRun();
    }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
