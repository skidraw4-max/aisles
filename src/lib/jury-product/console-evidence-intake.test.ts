import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveAnalysisPeriod } from '@/lib/ai-review-board/analysis-period';
import type { JuryActor } from './access';
import {
  buildConsoleIntakeInput,
  catalogMetricsForGrants,
  consoleIntakeCode,
  projectConsoleEvidence,
  projectConsoleIntakeForm,
  type ConsoleIntakeCommand,
} from './console-evidence-intake';
import type { JuryConsoleView } from './console-view';
import { persistTenantEvidenceIntake } from './tenant-evidence-intake-store';
import type { JuryMembership } from './records';

const TENANT = 'phase45c-console';
const FOREIGN = 'phase45c-foreign';
const CONN = 'phase45c-conn';
const CONN_B = 'phase45c-conn-b';
const FOREIGN_CONN = 'phase45c-foreign-conn';
const SCOPE = 'phase45c-scope';
const SCOPE_PROPOSED = 'phase45c-scope-proposed';
const SCOPE_REVOKED = 'phase45c-scope-revoked';
const SCOPE_OTHER = 'phase45c-scope-other';
const SCOPE_PLACEHOLDER = 'phase45c-scope-placeholder';
const FOREIGN_SCOPE = 'phase45c-foreign-scope';
const NOW = '2026-10-02T00:30:00.000Z';
const SECRET = 'password=hidden';
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';

const owner = membership('phase45c-owner-m', TENANT, 'phase45c-owner', 'OWNER');
const member = membership('phase45c-member-m', TENANT, 'phase45c-member', 'MEMBER');
const auditor = membership('phase45c-auditor-m', TENANT, 'phase45c-auditor', 'AUDITOR');
const ownerActor: JuryActor = { ok: true, userId: owner.userId, tenantId: TENANT, role: 'OWNER', membershipId: owner.id };
const memberActor: JuryActor = { ok: true, userId: member.userId, tenantId: TENANT, role: 'MEMBER', membershipId: member.id };
const auditorActor: JuryActor = { ok: true, userId: auditor.userId, tenantId: TENANT, role: 'AUDITOR', membershipId: auditor.id };

test('the evidence form offers catalog grants only to an owner', () => {
  const catalog = view([
    scope(SCOPE, CONN, 'APPROVED', ['newUsersLast7d', 'userCount']),
    scope(SCOPE_PROPOSED, CONN, 'PROPOSED', ['postCount']),
    scope(SCOPE_PLACEHOLDER, CONN, 'APPROVED', ['acme.routes', 'acme.api']),
  ]);
  const ownerForm = projectConsoleIntakeForm(ownerActor, catalog);
  assert.equal(ownerForm.visible, true);
  assert.deepEqual(ownerForm.scopes.map((row) => row.scopeId), [SCOPE]);
  assert.deepEqual(ownerForm.scopes[0]?.metrics, ['newUsersLast7d', 'userCount']);
  assert.equal(ownerForm.scopes.some((row) => row.metrics.some((metric) => metric.endsWith('.routes') || metric.endsWith('.api'))), false);
  assert.equal(projectConsoleIntakeForm(memberActor, catalog).visible, false);
  assert.equal(projectConsoleIntakeForm(auditorActor, catalog).visible, false);
  assert.deepEqual(catalogMetricsForGrants([{ resource: 'metric:acme.routes', mode: 'READ' }]), []);
  assert.deepEqual(projectConsoleIntakeForm(ownerActor, view([scope(SCOPE_PLACEHOLDER, CONN, 'APPROVED', ['acme.routes', 'acme.api'])])).scopes, []);
});

test('console intake fixes source, period, and tenant on the server', () => {
  const built = buildConsoleIntakeInput(command({}));
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const period = resolveAnalysisPeriod(new Date(NOW));
  assert.equal(built.intake.clientTenantId, null);
  assert.equal(built.intake.sourceSystem, 'OTHER');
  assert.equal(built.intake.sourceRef, 'console-declared');
  assert.equal(built.intake.adapterKey, 'console-declared');
  assert.equal(built.intake.adapterVersion, 'v1');
  assert.equal(built.intake.timezone, 'Asia/Seoul');
  assert.equal(built.intake.periodStart, period.start);
  assert.equal(built.intake.periodEnd, period.end);
  assert.equal(built.intake.metrics[0]?.value, 0);
  const secret = buildConsoleIntakeInput(command({ metric: SECRET, value: '1' }));
  assert.equal(secret.ok, false);
  if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
  assert.equal(JSON.stringify(secret).includes(SECRET), false);
  assert.equal(consoleIntakeCode({ ok: false, reason: `PERSISTENCE_FAILED ${SECRET}` }), 'PERSISTENCE_FAILED');
  assert.equal(consoleIntakeCode({ ok: false, reason: 'PERSISTENCE_FAILED' }), 'PERSISTENCE_FAILED');
  assert.equal(consoleIntakeCode({ ok: true, created: false }), 'EVIDENCE_REUSED');
});

test('console intake stores one declared metric and ignores a second submit', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);
    const proposed = await submit({ scopeId: SCOPE_PROPOSED });
    assert.equal(proposed.ok, false);
    if (!proposed.ok) assert.equal(proposed.reason, 'SCOPE_NOT_APPROVED');
    const revoked = await submit({ scopeId: SCOPE_REVOKED });
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, 'SCOPE_NOT_APPROVED');
    const foreignConnection = await submit({ connectionId: FOREIGN_CONN });
    assert.equal(foreignConnection.ok, false);
    if (!foreignConnection.ok) assert.equal(foreignConnection.reason, 'NOT_FOUND');
    const foreignScope = await submit({ scopeId: FOREIGN_SCOPE });
    assert.equal(foreignScope.ok, false);
    if (!foreignScope.ok) assert.equal(foreignScope.reason, 'NOT_FOUND');
    const crossed = await submit({ connectionId: CONN, scopeId: SCOPE_OTHER });
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'SCOPE_CONNECTION_MISMATCH');
    const asMember = await submit({ userId: member.userId, memberships: [member] });
    assert.equal(asMember.ok, false);
    if (!asMember.ok) assert.equal(asMember.reason, 'FORBIDDEN');
    const asAuditor = await submit({ userId: auditor.userId, memberships: [auditor] });
    assert.equal(asAuditor.ok, false);
    if (!asAuditor.ok) assert.equal(asAuditor.reason, 'FORBIDDEN');
    const unknown = await submit({ metric: 'revenue' });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, 'METRIC_NOT_IN_CATALOG');
    const outside = await submit({ metric: 'ga4.newUsers' });
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.reason, 'METRIC_NOT_IN_SCOPE');
    const placeholder = await submit({ metric: 'acme.routes', scopeId: SCOPE_PLACEHOLDER });
    assert.equal(placeholder.ok, false);
    if (!placeholder.ok) assert.equal(placeholder.reason, 'METRIC_NOT_IN_CATALOG');
    const secret = await submit({ metric: SECRET });
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(JSON.stringify(secret).includes(SECRET), false);
    await assertUntouched(prisma);

    const stored = await submit({});
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.equal(stored.created, true);
    const again = await submit({});
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.created, false);
      assert.equal(again.evidenceId, stored.evidenceId);
    }
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: 'EVIDENCE_INTAKE_COMPLETED' } }), 1);
    const { loadJuryCatalog } = await import('./jury-db');
    const catalog = await loadJuryCatalog(TENANT);
    const rows = projectConsoleEvidence({ evidence: catalog.evidence, metrics: catalog.metrics });
    const row = rows.find((item) => item.id === stored.evidenceId);
    assert.ok(row);
    assert.equal(row?.purpose, 'tenant-declared-observation');
    assert.equal(row?.metricCount, 1);
    assert.equal(row?.metrics[0]?.metric, 'newUsersLast7d');
    assert.equal(row?.metrics[0]?.value, 0);
    assert.equal(row?.metrics[0]?.availability, 'AVAILABLE');
    assert.equal(row?.metrics[0]?.sourceSystem, 'OTHER');
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: FOREIGN } }), 0);
    const foreignCatalog = await loadJuryCatalog(FOREIGN);
    assert.equal(projectConsoleEvidence({ evidence: foreignCatalog.evidence, metrics: foreignCatalog.metrics }).length, 0);
    assert.equal(await prisma.juryReviewResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryDecisionCycle.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryAgentExecution.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryChangeGateResult.count({ where: { tenantId: TENANT } }), 0);
    assert.equal(await prisma.juryReReviewResult.count({ where: { tenantId: TENANT } }), 0);
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

test('console intake does not call the host adapter or put tenant in the form', () => {
  const files = [
    'src/lib/jury-product/console-evidence-intake.ts',
    'src/app/(root)/jury/actions.ts',
    'src/app/(root)/jury/ui.tsx',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('buildEvidencePackFromDb'), false, file);
    assert.equal(source.includes('attachGa4Evidence'), false, file);
    assert.equal(source.includes('runAisleAdapter'), false, file);
    assert.equal(source.includes('runProductReview'), false, file);
    assert.equal(source.includes('runReviewBoardPipeline'), false, file);
    assert.equal(source.includes('evidence-builder'), false, file);
    assert.equal(source.includes('aisle-adapter'), false, file);
  }
  const action = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/actions.ts'), 'utf8');
  const submitAction = action.slice(action.indexOf('export async function submitTenantEvidenceIntake'));
  assert.equal(submitAction.includes('persistTenantEvidenceIntake'), true);
  assert.equal(submitAction.includes('clientTenantId: null'), true);
  assert.equal(submitAction.includes('getJuryActor()'), true);
  assert.equal(submitAction.includes("formData.get('tenantId')"), false);
  assert.equal(submitAction.includes('error.message'), false);
  const ui = readFileSync(path.resolve(process.cwd(), 'src/app/(root)/jury/ui.tsx'), 'utf8');
  const body = ui.slice(ui.indexOf('export function EvidenceBody'), ui.indexOf('export function ImprovementsBody'));
  assert.equal(body.includes('tenantId'), false);
  assert.equal(body.includes('Create Evidence'), true);
  assert.equal(body.includes('name="metric"'), true);
  assert.equal(body.includes('name="availability"'), true);
  assert.equal(body.includes('name="value"'), true);
  assert.equal(body.includes('현재 승인된 Scope에는 입력 가능한 Catalog Metric이 없습니다.'), true);
  assert.equal(ui.includes('다른 tenant의 데이터는 변경할 수 없습니다.'), true);
  assert.equal(ui.includes('Evidence를 저장하지 못했습니다.'), true);
  assert.equal(ui.includes('자격 증명이 포함된 요청은 기록하지 않습니다.'), true);
});

async function submit(overrides: Partial<ConsoleIntakeCommand>) {
  const built = buildConsoleIntakeInput(command(overrides));
  if (!built.ok) return built;
  return persistTenantEvidenceIntake(built.intake);
}

function command(overrides: Partial<ConsoleIntakeCommand>): ConsoleIntakeCommand {
  return {
    userId: owner.userId,
    memberships: [owner],
    connectionId: CONN,
    scopeId: SCOPE,
    metric: 'newUsersLast7d',
    availability: 'AVAILABLE',
    value: '0',
    now: NOW,
    ...overrides,
  };
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
}

function scope(id: string, connectionId: string, status: 'APPROVED' | 'PROPOSED' | 'REVOKED', metrics: string[]) {
  return {
    id,
    tenantId: TENANT,
    connectionId,
    status,
    grants: metrics.map((metric) => ({ resource: `metric:${metric}`, mode: 'READ' as const })),
  };
}

function view(scopes: ReturnType<typeof scope>[]): JuryConsoleView {
  return {
    tenantId: TENANT,
    role: 'OWNER',
    connections: [{
      id: CONN,
      tenantId: TENANT,
      serviceKey: 'acme',
      displayName: 'Acme',
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      createdAt: NOW,
      updatedAt: NOW,
    }],
    scopes,
    discoveries: [],
    metrics: [],
    evidence: [],
    requests: [],
    results: [],
    tasks: [],
    executions: [],
    gates: [],
    reReviews: [],
    audit: [],
    loopPolicy: { maxIterations: null, maxRuntimeMs: null, maxCostUsd: null },
  };
}

function loadEnv(): void {
  for (const [file, override] of [
    ['.env', false],
    ['.env.local', true],
  ] as const) {
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
    await prisma.user.create({
      data: { id: actor.userId, username: actor.userId, email: `${actor.userId}@example.invalid` },
    });
  }
  await prisma.juryTenant.create({ data: { id: TENANT, name: TENANT } });
  await prisma.juryTenant.create({ data: { id: FOREIGN, name: FOREIGN } });
  for (const actor of [owner, member, auditor]) {
    await prisma.juryMembership.create({
      data: { id: actor.id, tenantId: actor.tenantId, userId: actor.userId, role: actor.role, createdAt: new Date(NOW) },
    });
  }
  await connection(prisma, CONN, TENANT);
  await connection(prisma, CONN_B, TENANT);
  await connection(prisma, FOREIGN_CONN, FOREIGN);
  const grants = ['newUsersLast7d', 'userCount'].map((metric) => ({ resource: `metric:${metric}`, mode: 'READ' }));
  await scopeRow(prisma, SCOPE, TENANT, CONN, 'APPROVED', grants);
  await scopeRow(prisma, SCOPE_PROPOSED, TENANT, CONN, 'PROPOSED', grants);
  await scopeRow(prisma, SCOPE_REVOKED, TENANT, CONN, 'REVOKED', grants);
  await scopeRow(prisma, SCOPE_OTHER, TENANT, CONN_B, 'APPROVED', grants);
  await scopeRow(prisma, SCOPE_PLACEHOLDER, TENANT, CONN, 'APPROVED', [
    { resource: 'metric:acme.routes', mode: 'READ' },
    { resource: 'metric:acme.api', mode: 'READ' },
  ]);
  await scopeRow(prisma, FOREIGN_SCOPE, FOREIGN, FOREIGN_CONN, 'APPROVED', grants);
}

async function connection(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId: string,
): Promise<void> {
  await prisma.juryServiceConnection.create({
    data: {
      id,
      tenantId,
      serviceKey: 'acme',
      displayName: id,
      accessMethod: 'FILE_UPLOAD',
      status: 'DISCOVERY_PENDING',
      credentialRef: null,
      createdByUserId: owner.userId,
    },
  });
}

async function scopeRow(
  prisma: Awaited<typeof import('@/lib/prisma')>['prisma'],
  id: string,
  tenantId: string,
  connectionId: string,
  status: 'APPROVED' | 'PROPOSED' | 'REVOKED',
  grants: unknown,
): Promise<void> {
  await prisma.juryAccessScope.create({
    data: { id, tenantId, connectionId, status, grants: grants as object },
  });
}

async function assertUntouched(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  assert.equal(await prisma.juryEvidence.count({ where }), 0);
  assert.equal(await prisma.juryNormalizedMetric.count({ where }), 0);
  assert.equal(await prisma.juryAuditEvent.count({ where }), 0);
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
  };
}

async function removeFixture(prisma: Awaited<typeof import('@/lib/prisma')>['prisma']): Promise<void> {
  const where = { tenantId: { in: [TENANT, FOREIGN] } };
  await prisma.juryNormalizedMetric.deleteMany({ where });
  await prisma.juryEvidence.deleteMany({ where });
  await prisma.juryAuditEvent.deleteMany({ where });
  await prisma.juryAccessScope.deleteMany({ where });
  await prisma.juryServiceConnection.deleteMany({ where });
  await prisma.juryMembership.deleteMany({ where });
  await prisma.juryTenant.deleteMany({ where: { id: { in: [TENANT, FOREIGN] } } });
  await prisma.user.deleteMany({
    where: { username: { in: ['phase45c-owner', 'phase45c-member', 'phase45c-auditor'] } },
  });
}
