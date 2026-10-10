/**
 * Service onboarding uses MockDiscoveryAdapter and the current tenant only.
 * Run: node --import tsx --test src/lib/jury-product/service-onboarding.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryActor } from './access';
import type { JuryConsoleView } from './console-view';
import type { JuryMembership } from './records';
import { openPreviewDbTest, selectExactTest } from './preview-db-guard';
import {
  MOCK_ONBOARDING_ADAPTER,
  ONBOARDING_EMPTY_SCOPES,
  persistOnboardingDiscovery,
  persistOnboardingScopeDecision,
  persistServiceOnboarding,
  projectServiceOnboarding,
  projectServiceRows,
  screenCredentialRef,
} from './service-onboarding';

const TENANT = 'phase72-onboard';
const FOREIGN = 'phase72-onboard-foreign';
const FOREIGN_CONN = 'phase72-foreign-conn';
const FOREIGN_SCOPE = 'phase72-foreign-scope';
const NOW = '2026-10-04T12:00:00.000Z';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const REF = 'mock-connection-001';
const SECRET = 'password=hidden';

const owner = membership('phase72-owner-m', TENANT, 'phase72-owner', 'OWNER');
const member = membership('phase72-member-m', TENANT, 'phase72-member', 'DEVELOPER');
const auditor = membership('phase72-auditor-m', TENANT, 'phase72-auditor', 'VIEWER');
const foreign = membership('phase72-foreign-m', FOREIGN, 'phase72-foreign', 'OWNER');
const ownerActor = actor(owner);
const memberActor = actor(member);
const auditorActor = actor(auditor);

test('onboarding projection stays in the tenant and does not treat an empty scope list as zero', () => {
  assert.equal(screenCredentialRef(REF).ok, true);
  assert.equal(screenCredentialRef('  ').ok, false);
  const secret = screenCredentialRef(SECRET);
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason, 'SNAPSHOT_UNSAFE');
  const view = {
    tenantId: TENANT,
    connections: [
      connection('shop', TENANT, 'DISCOVERY_PENDING'),
      connection('other', 'tenant-b', 'CONNECTED'),
    ],
    discoveries: [],
    scopes: [],
  } as unknown as JuryConsoleView;
  const rows = projectServiceRows(view);
  assert.deepEqual(rows.map((row) => row.id), ['shop']);
  assert.equal(rows[0]?.discoveryStatus, 'Not started');
  assert.equal(rows[0]?.scopeStatus, ONBOARDING_EMPTY_SCOPES);
  assert.equal(projectServiceOnboarding(view, 'other'), null);
  const detail = projectServiceOnboarding(view, 'shop');
  assert.equal(detail?.canOpenEvidence, false);
  assert.equal(detail?.credentialLabel, 'Not available');
});

test('onboarding source reuses mock discovery and does not call the network', () => {
  const source = readFileSync(new URL('./service-onboarding.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('runMockDiscovery'), true);
  assert.equal(source.includes('createAccessContext'), true);
  assert.equal(source.includes('containsSecret'), true);
  for (const token of ['runReviewBoardPipeline', 'evaluateChangeGate', 'fakeCursorAdapter', 'buildEvidencePackFromDb', 'JURY_CONSOLE_FIXTURE']) {
    assert.equal(source.includes(token), false, token);
  }
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/service-onboarding-ui.tsx'), 'utf8');
  assert.equal(ui.includes('Add Service') || readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8').includes('Add Service'), true);
  assert.equal(ui.includes('No access scopes proposed.'), false);
  assert.equal(ui.includes('ONBOARDING_EMPTY_SCOPES'), true);
  assert.equal(ui.includes('Approve'), true);
  assert.equal(ui.includes('Reject'), true);
  for (const label of ['Run Agent', 'Run Change Gate', 'Run Re-review', 'Auto Fix', 'Run Loop']) {
    assert.equal(ui.includes(label), false, label);
  }
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/app/(root)/jury/services/new/page.tsx')), true);
  assert.equal(existsSync(path.resolve(process.cwd(), 'src/app/(root)/jury/services/[connectionId]/page.tsx')), true);
  assert.equal(MOCK_ONBOARDING_ADAPTER, 'mock');
  const dbTest = readFileSync(new URL('./service-onboarding.test.ts', import.meta.url), 'utf8');
  const name = 'owner onboarding connects only after scope approval';
  const owner = dbTest.slice(dbTest.lastIndexOf(name), dbTest.lastIndexOf('function loadEnv'));
  assert.equal(owner.startsWith(name), true);
  assert.equal(owner.indexOf('openPreviewDbTest') < owner.indexOf('loadEnv();'), true);
  assert.equal(owner.indexOf('openPreviewDbTest') < owner.indexOf('removeFixture'), true);
  assert.equal(selectExactTest(dbTest, name).ok, true);
});

test('owner onboarding connects only after scope approval', { timeout: 180_000 }, async () => {
  const gate = await openPreviewDbTest(process.env, async () => {
    const { prisma } = await import('@/lib/prisma');
    const rows = await prisma.$queryRaw<Array<{ failed: number }>>`
      SELECT count(*)::int AS failed
      FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `;
    return Number(rows[0]?.failed ?? 1);
  });
  if (!gate.ok) assert.fail(gate.status);
  loadEnv();
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const denied = await persistServiceOnboarding(command(memberActor, 'phase72-secret'));
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, 'FORBIDDEN');
    const auditorDenied = await persistServiceOnboarding(command(auditorActor, 'phase72-secret'));
    assert.equal(auditorDenied.ok, false);
    if (!auditorDenied.ok) assert.equal(auditorDenied.reason, 'FORBIDDEN');
    const unsafe = await persistServiceOnboarding(command(ownerActor, 'phase72-secret', SECRET));
    assert.equal(unsafe.ok, false);
    if (!unsafe.ok) assert.equal(unsafe.reason, 'SNAPSHOT_UNSAFE');
    assert.equal(await prisma.juryServiceConnection.count({ where: { tenantId: TENANT, serviceKey: 'phase72-secret' } }), 0);

    const [left, right] = await Promise.all([
      persistServiceOnboarding(command(ownerActor, 'phase72-shop')),
      persistServiceOnboarding(command(ownerActor, 'phase72-shop')),
    ]);
    const created = [left, right].filter((row) => row.ok && row.created);
    assert.equal(created.length, 1);
    assert.equal(await prisma.juryServiceConnection.count({ where: { tenantId: TENANT, serviceKey: 'phase72-shop' } }), 1);
    const shop = created[0];
    assert.ok(shop && shop.ok);
    if (!shop || !shop.ok) return;
    assert.equal(shop.status, 'DISCOVERY_PENDING');
    const again = await persistServiceOnboarding(command(ownerActor, 'phase72-shop'));
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.created, false);
      assert.equal(again.connectionId, shop.connectionId);
    }
    const stored = await prisma.juryServiceConnection.findFirst({ where: { id: shop.connectionId, tenantId: TENANT } });
    assert.equal(stored?.credentialRef, REF);
    assert.equal(stored?.tenantId, TENANT);

    const memberDiscovery = await persistOnboardingDiscovery({ actor: memberActor, connectionId: shop.connectionId, clientTenantId: FOREIGN });
    assert.equal(memberDiscovery.ok, false);
    if (!memberDiscovery.ok) assert.equal(memberDiscovery.reason, 'FORBIDDEN');
    const foreignDiscovery = await persistOnboardingDiscovery({ actor: ownerActor, connectionId: FOREIGN_CONN, clientTenantId: FOREIGN });
    assert.equal(foreignDiscovery.ok, false);
    if (!foreignDiscovery.ok) assert.equal(foreignDiscovery.reason, 'NOT_FOUND');
    const [firstDiscovery, secondDiscovery] = await Promise.all([
      persistOnboardingDiscovery({ actor: ownerActor, connectionId: shop.connectionId, clientTenantId: FOREIGN, now: NOW }),
      persistOnboardingDiscovery({ actor: ownerActor, connectionId: shop.connectionId, clientTenantId: FOREIGN, now: NOW }),
    ]);
    const discoveries = [firstDiscovery, secondDiscovery].filter((row) => row.ok);
    assert.equal(discoveries.length, 1);
    assert.equal(await prisma.juryDiscoveryResult.count({ where: { tenantId: TENANT, connectionId: shop.connectionId } }), 1);
    const discovery = discoveries[0];
    assert.ok(discovery && discovery.ok);
    if (!discovery || !discovery.ok) return;
    const scope = await prisma.juryAccessScope.findFirst({ where: { id: discovery.scopeId, tenantId: TENANT } });
    assert.equal(scope?.status, 'PROPOSED');
    assert.equal(JSON.stringify(scope?.grants).includes('READ'), true);

    const memberScope = await persistOnboardingScopeDecision({
      actor: memberActor,
      scopeId: discovery.scopeId,
      decision: 'APPROVE',
      clientTenantId: FOREIGN,
    });
    assert.equal(memberScope.ok, false);
    if (!memberScope.ok) assert.equal(memberScope.reason, 'FORBIDDEN');
    const auditorScope = await persistOnboardingScopeDecision({
      actor: auditorActor,
      scopeId: discovery.scopeId,
      decision: 'REJECT',
    });
    assert.equal(auditorScope.ok, false);
    if (!auditorScope.ok) assert.equal(auditorScope.reason, 'FORBIDDEN');
    const foreignScope = await persistOnboardingScopeDecision({
      actor: ownerActor,
      scopeId: FOREIGN_SCOPE,
      decision: 'APPROVE',
      clientTenantId: FOREIGN,
    });
    assert.equal(foreignScope.ok, false);
    if (!foreignScope.ok) assert.equal(foreignScope.reason, 'NOT_FOUND');
    assert.equal(await prisma.juryAccessScope.findFirst({ where: { id: FOREIGN_SCOPE } }).then((row) => row?.status), 'PROPOSED');

    const [approved, replay] = await Promise.all([
      persistOnboardingScopeDecision({ actor: ownerActor, scopeId: discovery.scopeId, decision: 'APPROVE', clientTenantId: FOREIGN, now: NOW }),
      persistOnboardingScopeDecision({ actor: ownerActor, scopeId: discovery.scopeId, decision: 'APPROVE', clientTenantId: FOREIGN, now: NOW }),
    ]);
    const approvals = [approved, replay].filter((row) => row.ok);
    assert.equal(approvals.length, 1);
    const approval = approvals[0];
    assert.ok(approval && approval.ok);
    if (!approval || !approval.ok) return;
    assert.equal(approval.activated, true);
    assert.equal(approval.connectionStatus, 'CONNECTED');
    assert.equal(approval.scopeStatus, 'APPROVED');
    assert.equal(approval.auditAction, 'SCOPE_APPROVED');
    assert.equal(approval.connectionId, shop.connectionId);
    const connected = await prisma.juryServiceConnection.findFirst({ where: { id: shop.connectionId } });
    assert.equal(connected?.status, 'CONNECTED');
    assert.equal(connected?.tenantId, TENANT);

    const blocked = await persistServiceOnboarding(command(ownerActor, 'phase72-blocked'));
    assert.equal(blocked.ok, true);
    if (!blocked.ok) return;
    const blockedDiscovery = await persistOnboardingDiscovery({ actor: ownerActor, connectionId: blocked.connectionId, now: NOW });
    assert.equal(blockedDiscovery.ok, true);
    if (!blockedDiscovery.ok) return;
    await prisma.juryAccessScope.create({
      data: {
        id: 'phase72-extra-scope',
        tenantId: TENANT,
        connectionId: blocked.connectionId,
        status: 'PROPOSED',
        grants: [{ resource: 'metric:phase72-blocked.extra', mode: 'READ' }],
      },
    });
    const held = await persistOnboardingScopeDecision({
      actor: ownerActor,
      scopeId: blockedDiscovery.scopeId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(held.ok, true);
    if (held.ok) {
      assert.equal(held.activated, false);
      assert.notEqual(held.connectionStatus, 'CONNECTED');
    }
    assert.notEqual(await prisma.juryServiceConnection.findFirst({ where: { id: blocked.connectionId } }).then((row) => row?.status), 'CONNECTED');

    const rejected = await persistServiceOnboarding(command(ownerActor, 'phase72-rejected'));
    assert.equal(rejected.ok, true);
    if (!rejected.ok) return;
    const rejectedDiscovery = await persistOnboardingDiscovery({ actor: ownerActor, connectionId: rejected.connectionId, now: NOW });
    assert.equal(rejectedDiscovery.ok, true);
    if (!rejectedDiscovery.ok) return;
    const rejection = await persistOnboardingScopeDecision({
      actor: ownerActor,
      scopeId: rejectedDiscovery.scopeId,
      decision: 'REJECT',
      now: NOW,
    });
    assert.equal(rejection.ok, true);
    if (rejection.ok) {
      assert.equal(rejection.activated, false);
      assert.equal(rejection.scopeStatus, 'REVOKED');
      assert.equal(rejection.auditAction, 'SCOPE_REVOKED');
      assert.notEqual(rejection.connectionStatus, 'CONNECTED');
    }

    const missingRef = await persistServiceOnboarding(command(ownerActor, 'phase72-noref'));
    assert.equal(missingRef.ok, true);
    if (!missingRef.ok) return;
    await prisma.juryServiceConnection.update({ where: { id: missingRef.connectionId }, data: { credentialRef: null } });
    const missingDiscovery = await persistOnboardingDiscovery({ actor: ownerActor, connectionId: missingRef.connectionId, now: NOW });
    assert.equal(missingDiscovery.ok, true);
    if (!missingDiscovery.ok) return;
    const missingApproval = await persistOnboardingScopeDecision({
      actor: ownerActor,
      scopeId: missingDiscovery.scopeId,
      decision: 'APPROVE',
      now: NOW,
    });
    assert.equal(missingApproval.ok, true);
    if (missingApproval.ok) assert.equal(missingApproval.activated, false);
    assert.notEqual(await prisma.juryServiceConnection.findFirst({ where: { id: missingRef.connectionId } }).then((row) => row?.status), 'CONNECTED');

    const audits = await prisma.juryAuditEvent.findMany({ where: { tenantId: TENANT } });
    const auditText = JSON.stringify(audits);
    assert.equal(auditText.includes(SECRET), false);
    assert.equal(auditText.toLowerCase().includes('password'), false);
    assert.equal(auditText.includes(REF), false);
    const shopAudits = audits.filter((row) => row.serviceKey === 'phase72-shop').map((row) => row.action);
    assert.equal(shopAudits.filter((action) => action === 'SERVICE_CONNECTION_CREATED').length, 1);
    assert.equal(shopAudits.filter((action) => action === 'SERVICE_DISCOVERY_STARTED').length, 1);
    assert.equal(shopAudits.filter((action) => action === 'SERVICE_CONNECTION_ACTIVATED').length, 1);
    const actions = audits.map((row) => row.action);
    assert.equal(actions.includes('DISCOVERY_RECORDED'), true);
    assert.equal(actions.includes('SCOPE_PROPOSED'), true);
    assert.equal(actions.includes('SCOPE_APPROVED'), true);
    assert.equal(actions.includes('SCOPE_REVOKED'), true);
    assert.equal(audits.filter((row) => row.serviceKey === 'phase72-rejected' && row.action === 'SERVICE_CONNECTION_ACTIVATED').length, 0);
    assert.equal(audits.every((row) => row.tenantId === TENANT), true);

    const where = { tenantId: { in: [TENANT, FOREIGN] } };
    assert.equal(await prisma.juryEvidence.count({ where }), 0);
    assert.equal(await prisma.juryReviewRequest.count({ where }), 0);
    assert.equal(await prisma.juryReviewResult.count({ where }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where }), 0);
    assert.deepEqual(await liveSnapshot(prisma), liveBefore);
  } finally {
    await removeFixture(prisma);
  }
});

function command(actor: Extract<JuryActor, { ok: true }>, serviceKey: string, credentialRef = REF) {
  return {
    actor,
    serviceKey,
    displayName: serviceKey,
    accessMethod: 'FILE_UPLOAD' as const,
    credentialRef,
    adapterKey: MOCK_ONBOARDING_ADAPTER,
    clientTenantId: FOREIGN,
    now: NOW,
  };
}

function connection(id: string, tenantId: string, status: 'DISCOVERY_PENDING' | 'CONNECTED') {
  return {
    id,
    tenantId,
    serviceKey: id,
    displayName: id,
    accessMethod: 'FILE_UPLOAD' as const,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function actor(row: JuryMembership): Extract<JuryActor, { ok: true }> {
  return { ok: true, userId: row.userId, tenantId: row.tenantId, role: row.role, membershipId: row.id };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
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
      if (!key || key === 'DATABASE_URL' || key === 'DIRECT_URL' || (process.env[key] && !override)) continue;
      process.env[key] = raw.replace(/^"|"$/g, '');
    }
  }
}

async function seed(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  for (const row of [owner, member, auditor, foreign]) {
    await prisma.user.create({ data: { id: row.userId, username: row.userId, email: `${row.userId}@example.invalid` } });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const row of [owner, member, auditor, foreign]) {
    await prisma.juryMembership.create({
      data: { id: row.id, tenantId: row.tenantId, userId: row.userId, role: row.role, createdAt: new Date(NOW) },
    });
  }
  await prisma.juryServiceConnection.create({
    data: {
      id: FOREIGN_CONN,
      tenantId: FOREIGN,
      serviceKey: 'phase72-foreign',
      displayName: 'Foreign',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
    },
  });
  await prisma.juryDiscoveryResult.create({
    data: {
      id: 'phase72-foreign-discovery',
      tenantId: FOREIGN,
      connectionId: FOREIGN_CONN,
      exploredAt: new Date(NOW),
      surfaces: ['API'],
      menus: ['/'],
      dataSources: ['API'],
      feasibility: 'PARTIAL',
      proposedMetrics: [{ metric: 'phase72-foreign.routes', reason: '후보' }],
      approval: 'PENDING',
    },
  });
  await prisma.juryAccessScope.create({
    data: {
      id: FOREIGN_SCOPE,
      tenantId: FOREIGN,
      connectionId: FOREIGN_CONN,
      status: 'PROPOSED',
      grants: [{ resource: 'metric:phase72-foreign.routes', mode: 'READ' }],
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
    where: { username: { in: ['phase72-owner', 'phase72-member', 'phase72-auditor', 'phase72-foreign'] } },
  });
}
