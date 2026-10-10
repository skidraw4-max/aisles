import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import {
  catalogScopeCode,
  persistCatalogScope,
  persistCatalogScopeDecision,
  projectCatalogScopeForm,
  scopeForDiscovery,
  type CatalogScopeCommand,
} from './console-catalog-scope';
import { buildMockDiscovery } from './discovery';
import type { JuryConsoleView } from './console-view';
import type { JuryAccessScope, JuryMembership, JuryServiceConnection } from './records';

const TENANT = 'phase46c-scope';
const FOREIGN = 'phase46c-scope-foreign';
const CONN = 'phase46c-scope-conn';
const FOREIGN_CONN = 'phase46c-scope-foreign-conn';
const NOW = '2026-10-02T01:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase46c-scope-owner-m', TENANT, 'phase46c-scope-owner', 'OWNER');
const member = membership('phase46c-scope-member-m', TENANT, 'phase46c-scope-member', 'DEVELOPER');
const auditor = membership('phase46c-scope-auditor-m', TENANT, 'phase46c-scope-auditor', 'VIEWER');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'DEVELOPER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'VIEWER', membershipId: auditor.id };

test('catalog scope form is owner-only and ignores placeholder metrics', () => {
  const view = {
    connections: [connection(CONN, TENANT, 'acme')],
    scopes: [
      scope('placeholder', CONN, 'PROPOSED', ['acme.routes', 'acme.api']),
      scope('catalog', CONN, 'PROPOSED', ['newUsersLast7d']),
    ],
  } as Pick<JuryConsoleView, 'connections' | 'scopes'>;
  const form = projectCatalogScopeForm(ownerActor, view);
  assert.equal(form.visible, true);
  assert.equal(form.metrics.includes('newUsersLast7d'), true);
  assert.equal(form.metrics.includes('ga4.newUsers'), true);
  assert.equal(form.metrics.some((metric) => metric.endsWith('.routes') || metric.endsWith('.api')), false);
  assert.deepEqual(form.pending.map((row) => row.scopeId), ['catalog']);
  assert.equal(projectCatalogScopeForm(memberActor, view).visible, false);
  assert.equal(projectCatalogScopeForm(auditorActor, view).visible, false);
  const discovery = buildMockDiscovery({
    actorTenantId: TENANT,
    connection: connection(CONN, TENANT, 'acme'),
    allocateId: sequence('disc', 'scope'),
  });
  assert.equal(discovery.ok, true);
  if (!discovery.ok) return;
  assert.deepEqual(discovery.discovery.proposedMetrics.map((item) => item.metric), ['acme.routes', 'acme.api']);
  assert.equal(discovery.scope.grants.some((grant) => grant.resource === 'metric:userCount'), false);
  const matched = scopeForDiscovery(discovery.discovery, [discovery.scope, scope('catalog', CONN, 'PROPOSED', ['userCount'])]);
  assert.equal(matched?.id, discovery.scope.id);
});

test('catalog scope proposal stays on catalog grants', { timeout: 120_000 }, async () => {
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const memberTry = await persistCatalogScope(command(member, { metric: 'newUsersLast7d' }));
    assert.equal(memberTry.ok, false);
    if (!memberTry.ok) assert.equal(memberTry.reason, 'FORBIDDEN');
    const auditorTry = await persistCatalogScope(command(auditor, { metric: 'newUsersLast7d' }));
    assert.equal(auditorTry.ok, false);
    if (!auditorTry.ok) assert.equal(auditorTry.reason, 'FORBIDDEN');
    const placeholder = await persistCatalogScope(command(owner, { metric: 'acme.routes' }));
    assert.equal(placeholder.ok, false);
    if (!placeholder.ok) assert.equal(placeholder.reason, 'METRIC_NOT_IN_CATALOG');
    const foreign = await persistCatalogScope(command(owner, { connectionId: FOREIGN_CONN, metric: 'userCount' }));
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.equal(foreign.reason, 'NOT_FOUND');
    const client = await persistCatalogScope(command(owner, { metric: 'userCount', clientTenantId: FOREIGN }));
    assert.equal(client.ok, false);
    if (!client.ok) assert.equal(client.reason, 'TENANT_MISMATCH');
    assert.equal(await prisma.juryAccessScope.count({ where: { tenantId: TENANT } }), 1);

    const first = await persistCatalogScope(command(owner, { metric: 'newUsersLast7d' }));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.created, true);
    assert.equal(first.status, 'PROPOSED');
    const second = await persistCatalogScope(command(owner, { metric: 'activeUsersLast7d' }));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.scopeId, first.scopeId);
    assert.deepEqual(second.grants.map((grant) => grant.resource), ['metric:activeUsersLast7d', 'metric:newUsersLast7d']);
    const again = await persistCatalogScope(command(owner, { metric: 'newUsersLast7d' }));
    assert.equal(again.ok, true);
    if (again.ok) assert.equal(again.created, false);
    assert.equal(catalogScopeCode(again), 'CATALOG_SCOPE_REUSED');

    const mockId = 'phase46c-mock-scope';
    await prisma.juryAccessScope.create({
      data: {
        id: mockId,
        tenantId: TENANT,
        connectionId: CONN,
        status: 'PROPOSED',
        grants: [{ resource: 'metric:acme.routes', mode: 'READ' }, { resource: 'metric:acme.api', mode: 'READ' }],
      },
    });
    const rejected = await persistCatalogScopeDecision({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: null,
      scopeId: mockId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.reason, 'METRIC_NOT_IN_CATALOG');
    const mockRow = await prisma.juryAccessScope.findUnique({ where: { id: mockId } });
    assert.equal(mockRow?.status, 'PROPOSED');
    assert.equal(JSON.stringify(mockRow?.grants).includes('userCount'), false);

    const memberDecision = await persistCatalogScopeDecision({
      userId: member.userId,
      memberships: [member],
      scopeId: first.scopeId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(memberDecision.ok, false);
    if (!memberDecision.ok) assert.equal(memberDecision.reason, 'FORBIDDEN');
    const approved = await persistCatalogScopeDecision({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: FOREIGN,
      scopeId: first.scopeId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.equal(approved.reason, 'TENANT_MISMATCH');
    const ok = await persistCatalogScopeDecision({
      userId: owner.userId,
      memberships: [owner],
      clientTenantId: null,
      scopeId: first.scopeId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.status, 'APPROVED');
    const row = await prisma.juryAccessScope.findUnique({ where: { id: first.scopeId } });
    assert.equal(row?.status, 'APPROVED');
    assert.equal(row?.approvedByUserId, owner.userId);
    assert.equal(await prisma.juryDiscoveryResult.count({ where: { tenantId: TENANT } }), 0);
  } finally {
    try {
      await removeFixture(prisma);
    } catch (error) {
      cleanupError = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]') : 'failed';
    }
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
    if (cleanupError) throw new Error(`CLEANUP_FAILED ${cleanupError}`);
  }
});

test('catalog scope source does not read the host', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/console-catalog-scope.ts'), 'utf8');
  for (const token of ['buildEvidencePackFromDb', 'attachGa4Evidence', 'runAisleAdapter', 'GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT', 'projectEvidenceToPack']) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('Catalog Metric Scope'), ui.indexOf('export function ReviewsBody'));
  assert.equal(body.includes('proposeCatalogScope'), true);
  assert.equal(body.includes('name="tenantId"'), false);
  assert.equal(body.includes('acme.routes'), false);
});

function command(actor: JuryMembership, overrides: Partial<CatalogScopeCommand>): CatalogScopeCommand {
  return {
    userId: actor.userId,
    memberships: [actor],
    clientTenantId: null,
    connectionId: CONN,
    metric: 'newUsersLast7d',
    now: NOW,
    ...overrides,
  };
}

function connection(id: string, tenantId: string, serviceKey: string): JuryServiceConnection {
  return {
    id,
    tenantId,
    serviceKey,
    displayName: serviceKey,
    accessMethod: 'FILE_UPLOAD',
    status: 'DISCOVERY_PENDING',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function scope(id: string, connectionId: string, status: JuryAccessScope['status'], metrics: string[]): JuryAccessScope {
  return {
    id,
    tenantId: TENANT,
    connectionId,
    status,
    grants: metrics.map((metric) => ({ resource: `metric:${metric}`, mode: 'READ' as const })),
  };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function sequence(...ids: string[]): () => string {
  const pending = [...ids];
  return () => pending.shift() ?? 'extra';
}

function loadEnv(): void {
  for (const [file, override] of [['.env', false], ['.env.local', true]] as const) {
    let text = '';
    try {
      text = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}

async function seed(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  for (const actor of [owner, member, auditor]) {
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` } });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, member, auditor]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await prisma.juryServiceConnection.create({
    data: {
      id: CONN,
      tenantId: TENANT,
      serviceKey: 'acme',
      displayName: 'Acme',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  await prisma.juryServiceConnection.create({
    data: {
      id: FOREIGN_CONN,
      tenantId: FOREIGN,
      serviceKey: 'acme',
      displayName: 'Foreign',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: 'phase46c-seed-placeholder',
      tenantId: TENANT,
      connectionId: CONN,
      status: 'PROPOSED',
      grants: [{ resource: 'metric:acme.routes', mode: 'READ' }],
    },
  });
}

async function liveSnapshot(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']) {
  const review = await prisma.juryReviewResult.findUnique({
    where: { id: LIVE_REVIEW },
    select: { expectedDecision: true, tenantId: true, completedAt: true },
  });
  const cycle = await prisma.juryDecisionCycle.findUnique({
    where: { id: LIVE_CYCLE },
    select: { status: true, iteration: true, updatedAt: true },
  });
  const tenantId = review?.tenantId ?? 'missing';
  return {
    decision: review?.expectedDecision ?? null,
    reviewCompletedAt: review?.completedAt.toISOString() ?? null,
    status: cycle?.status ?? null,
    iteration: cycle?.iteration ?? null,
    cycleUpdatedAt: cycle?.updatedAt.toISOString() ?? null,
    activations: await prisma.juryAutoLoopActivation.count({ where: { tenantId } }),
    executions: await prisma.juryAgentExecution.count({ where: { tenantId } }),
    gates: await prisma.juryChangeGateResult.count({ where: { tenantId } }),
    reviews: await prisma.juryReviewResult.count({ where: { tenantId } }),
    reReviews: await prisma.juryReReviewResult.count({ where: { tenantId } }),
    tasks: await prisma.juryImprovementTask.count({ where: { tenantId } }),
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryReviewResult.deleteMany({ where });
  await prisma.juryReviewRequest.deleteMany({ where });
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryDiscoveryResult.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase46c-scope-owner', 'phase46c-scope-member', 'phase46c-scope-auditor'] } },
  });
}
