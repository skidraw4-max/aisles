import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { JuryMembership } from './records';
import {
  buildDeclaredEvidence,
  intakeDeniedReason,
  TENANT_INTAKE_AUDIT,
  TENANT_INTAKE_PURPOSE,
  TENANT_INTAKE_RULE_ID,
  type DeclaredMetricInput,
  type TenantEvidenceIntakeInput,
} from './tenant-evidence-intake';
import { commitTenantEvidenceIntake, persistTenantEvidenceIntake } from './tenant-evidence-intake-store';

const TENANT = 'phase45-intake';
const FOREIGN = 'phase45-foreign';
const CONN = 'phase45-conn';
const CONN_B = 'phase45-conn-b';
const FOREIGN_CONN = 'phase45-foreign-conn';
const SCOPE = 'phase45-scope';
const SCOPE_PROPOSED = 'phase45-scope-proposed';
const SCOPE_REVOKED = 'phase45-scope-revoked';
const SCOPE_OTHER = 'phase45-scope-other';
const FOREIGN_SCOPE = 'phase45-foreign-scope';
const NOW = '2026-10-02T09:00:00.000Z';
const PERIOD = { start: '2026-09-01', end: '2026-09-07' };
const LIVE_REVIEW = '3707202563ecae9b38f324a4eefd9243a14bc69420ed6cdda16c4c5794f62e0d';
const LIVE_CYCLE = '14308b4c999ccbe8ca54b7f31da5385385d4073c49bbf2955582a6bb96afb01e';
const SECRET = 'password=hidden';

const owner = membership('phase45-owner-m', TENANT, 'phase45-owner', 'OWNER');
const member = membership('phase45-member-m', TENANT, 'phase45-member', 'MEMBER');
const auditor = membership('phase45-auditor-m', TENANT, 'phase45-auditor', 'AUDITOR');

const GRANTS = [
  'userCount',
  'newUsersLast7d',
  'activeUsersLast7d',
  'postCount',
  'postsLast7d',
  'commentsLast7d',
  'viewsLast7d',
  'totalViews',
  'commentCount',
].map((metric) => ({ resource: `metric:${metric}`, mode: 'READ' }));

test('declared availability keeps zero and clears missing measurements', () => {
  const cases: Array<{ availability: string; value: number | null; expectedAvailability: string; expectedValue: number | null }> = [
    { availability: 'AVAILABLE', value: 0, expectedAvailability: 'AVAILABLE', expectedValue: 0 },
    { availability: 'AVAILABLE', value: 12, expectedAvailability: 'AVAILABLE', expectedValue: 12 },
    { availability: 'AVAILABLE', value: null, expectedAvailability: 'NOT_MEASURED', expectedValue: null },
    { availability: 'AVAILABLE', value: Number.NaN, expectedAvailability: 'NOT_MEASURED', expectedValue: null },
    { availability: 'AVAILABLE', value: Number.POSITIVE_INFINITY, expectedAvailability: 'NOT_MEASURED', expectedValue: null },
    { availability: 'NOT_MEASURED', value: 4, expectedAvailability: 'NOT_MEASURED', expectedValue: null },
    { availability: 'NOT_AVAILABLE', value: 4, expectedAvailability: 'NOT_AVAILABLE', expectedValue: null },
    { availability: 'PERMISSION_DENIED', value: 4, expectedAvailability: 'PERMISSION_DENIED', expectedValue: null },
    { availability: 'COLLECTION_FAILED', value: 4, expectedAvailability: 'COLLECTION_FAILED', expectedValue: null },
  ];
  for (const row of cases) {
    const built = buildDeclaredEvidence({
      tenantId: TENANT,
      connectionId: CONN,
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      metrics: [{ metric: 'userCount', availability: row.availability, value: row.value }],
      sourceSystem: 'FILE',
      sourceRef: 'caller-declared',
      adapterKey: 'declared',
      adapterVersion: 'v1',
      now: NOW,
      grants: [{ resource: 'metric:userCount', mode: 'READ' }],
    });
    assert.equal(built.ok, true, row.availability);
    if (!built.ok) continue;
    assert.equal(built.metrics[0]?.availability, row.expectedAvailability);
    assert.equal(built.metrics[0]?.value, row.expectedValue);
    assert.equal(built.evidence.purpose, TENANT_INTAKE_PURPOSE);
    assert.equal(built.evidence.timezone, 'Asia/Seoul');
    assert.equal(built.metrics[0]?.ruleId, TENANT_INTAKE_RULE_ID);
  }
  const zero = declaredHash(0);
  const missing = declaredHash(null);
  assert.notEqual(zero, missing);
});

test('an owner without connection.write is refused', () => {
  assert.equal(intakeDeniedReason('OWNER', false), 'CONNECTION_WRITE_REQUIRED');
  assert.equal(intakeDeniedReason('MEMBER', true), 'FORBIDDEN');
  assert.equal(intakeDeniedReason('AUDITOR', true), 'FORBIDDEN');
  assert.equal(intakeDeniedReason('OWNER', true), null);
});

test('a failed metric insert rolls the evidence back', async () => {
  const state = { evidence: 0, metrics: 0, audits: 0 };
  const result = await commitTenantEvidenceIntake(request({ metrics: [metric('userCount', 'AVAILABLE', 1)] }), {
    async transaction(work) {
      const tx = {
        async lockConnection() {
          return { id: CONN, tenantId: TENANT, serviceKey: 'acme' };
        },
        async lockScope() {
          return { id: SCOPE, tenantId: TENANT, connectionId: CONN, status: 'APPROVED', grants: GRANTS };
        },
        async findEvidence() {
          return null;
        },
        async insertEvidence() {
          state.evidence += 1;
        },
        async insertMetric() {
          throw new Error('metric write failed');
        },
        async findAudit() {
          return null;
        },
        async insertAudit() {
          state.audits += 1;
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        state.evidence = 0;
        state.metrics = 0;
        state.audits = 0;
        throw error;
      }
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'PERSISTENCE_FAILED');
  assert.deepEqual(state, { evidence: 0, metrics: 0, audits: 0 });
  assert.equal(JSON.stringify(result).includes('metric write failed'), false);
});

test('intake stores declared catalog metrics for the actor tenant only', { timeout: 120_000 }, async () => {
  loadEnv();
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required');
  const { prisma } = await import('@/lib/prisma');
  const liveBefore = await liveSnapshot(prisma);
  let cleanupError: string | null = null;
  try {
    await removeFixture(prisma);
    await seed(prisma);

    const proposed = await persistTenantEvidenceIntake(request({ scopeId: SCOPE_PROPOSED }));
    assert.equal(proposed.ok, false);
    if (!proposed.ok) assert.equal(proposed.reason, 'SCOPE_NOT_APPROVED');
    const revoked = await persistTenantEvidenceIntake(request({ scopeId: SCOPE_REVOKED }));
    assert.equal(revoked.ok, false);
    if (!revoked.ok) assert.equal(revoked.reason, 'SCOPE_NOT_APPROVED');
    const foreignConnection = await persistTenantEvidenceIntake(request({ connectionId: FOREIGN_CONN }));
    assert.equal(foreignConnection.ok, false);
    if (!foreignConnection.ok) assert.equal(foreignConnection.reason, 'NOT_FOUND');
    const foreignScope = await persistTenantEvidenceIntake(request({ scopeId: FOREIGN_SCOPE }));
    assert.equal(foreignScope.ok, false);
    if (!foreignScope.ok) assert.equal(foreignScope.reason, 'NOT_FOUND');
    const mismatch = await persistTenantEvidenceIntake(request({ clientTenantId: FOREIGN }));
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.reason, 'TENANT_MISMATCH');
    const crossed = await persistTenantEvidenceIntake(request({ connectionId: CONN, scopeId: SCOPE_OTHER }));
    assert.equal(crossed.ok, false);
    if (!crossed.ok) assert.equal(crossed.reason, 'SCOPE_CONNECTION_MISMATCH');
    const asMember = await persistTenantEvidenceIntake(request({ userId: member.userId, memberships: [member] }));
    assert.equal(asMember.ok, false);
    if (!asMember.ok) assert.equal(asMember.reason, 'FORBIDDEN');
    const asAuditor = await persistTenantEvidenceIntake(request({ userId: auditor.userId, memberships: [auditor] }));
    assert.equal(asAuditor.ok, false);
    if (!asAuditor.ok) assert.equal(asAuditor.reason, 'FORBIDDEN');
    const unknown = await persistTenantEvidenceIntake(request({ metrics: [metric('revenue', 'AVAILABLE', 1)] }));
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.reason, 'METRIC_NOT_IN_CATALOG');
    const outside = await persistTenantEvidenceIntake(request({ metrics: [metric('ga4.newUsers', 'AVAILABLE', 1)] }));
    assert.equal(outside.ok, false);
    if (!outside.ok) assert.equal(outside.reason, 'METRIC_NOT_IN_SCOPE');
    const routes = await persistTenantEvidenceIntake(request({ metrics: [metric('acme.routes', 'AVAILABLE', 1)] }));
    assert.equal(routes.ok, false);
    if (!routes.ok) assert.equal(routes.reason, 'METRIC_NOT_IN_CATALOG');
    const api = await persistTenantEvidenceIntake(request({ metrics: [metric('acme.api', 'AVAILABLE', 1)] }));
    assert.equal(api.ok, false);
    if (!api.ok) assert.equal(api.reason, 'METRIC_NOT_IN_CATALOG');
    const secret = await persistTenantEvidenceIntake(request({ sourceRef: SECRET }));
    assert.equal(secret.ok, false);
    if (!secret.ok) assert.equal(secret.reason, 'CREDENTIAL_IN_REASON');
    assert.equal(JSON.stringify(secret).includes(SECRET), false);
    const wrongZone = await persistTenantEvidenceIntake(request({ timezone: 'UTC' }));
    assert.equal(wrongZone.ok, false);
    if (!wrongZone.ok) assert.equal(wrongZone.reason, 'INVALID_TIMEZONE');
    await assertUntouched(prisma);

    const stored = await persistTenantEvidenceIntake(request({}));
    assert.equal(stored.ok, true);
    if (!stored.ok) return;
    assert.equal(stored.scopeId, SCOPE);
    const evidence = await prisma.juryEvidence.findUnique({ where: { id: stored.evidenceId } });
    assert.ok(evidence);
    assert.equal(evidence?.tenantId, TENANT);
    assert.equal(evidence?.connectionId, CONN);
    assert.equal(evidence?.purpose, TENANT_INTAKE_PURPOSE);
    assert.equal(evidence?.timezone, 'Asia/Seoul');
    assert.equal(evidence?.piiExcluded, true);
    assert.equal(evidence?.readOnly, true);
    assert.equal(evidence?.contentHash, stored.contentHash);
    const rows = await prisma.juryNormalizedMetric.findMany({ where: { evidenceId: stored.evidenceId } });
    assert.equal(rows.length, STORED.length);
    const zero = rows.find((row) => row.metric === 'newUsersLast7d');
    const positive = rows.find((row) => row.metric === 'userCount');
    const missing = rows.find((row) => row.metric === 'activeUsersLast7d');
    assert.equal(zero?.value, 0);
    assert.equal(zero?.availability, 'AVAILABLE');
    assert.equal(positive?.value, 12);
    assert.equal(missing?.value, null);
    assert.equal(missing?.availability, 'NOT_MEASURED');
    for (const row of rows) {
      assert.equal(row.sourceSystem, 'FILE');
      assert.equal(row.sourceRef, 'caller-declared');
      assert.equal(row.adapterKey, 'declared');
      assert.equal(row.adapterVersion, 'v1');
      assert.equal(row.ruleId, TENANT_INTAKE_RULE_ID);
      assert.equal(row.timezone, 'Asia/Seoul');
    }
    const audit = await prisma.juryAuditEvent.findFirst({
      where: { tenantId: TENANT, action: TENANT_INTAKE_AUDIT, evidenceId: stored.evidenceId },
    });
    assert.equal(audit?.scopeId, SCOPE);
    assert.equal(audit?.actor, owner.userId);
    assert.equal(audit?.serviceKey, 'acme');
    const storedText = JSON.stringify({ evidence, rows, audit });
    assert.equal(storedText.includes(SECRET), false);
    assert.equal(storedText.includes('credentialRef'), false);
    assert.equal(storedText.toLowerCase().includes('api_key'), false);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: TENANT_INTAKE_AUDIT } }), 1);

    const replay = await persistTenantEvidenceIntake(request({}));
    assert.equal(replay.ok, true);
    if (replay.ok) {
      assert.equal(replay.created, false);
      assert.equal(replay.evidenceId, stored.evidenceId);
    }
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: TENANT_INTAKE_AUDIT } }), 1);

    const changed = await persistTenantEvidenceIntake(request({
      metrics: STORED.map((row) => (row.metric === 'userCount' ? metric('userCount', 'AVAILABLE', 99) : row)),
    }));
    assert.equal(changed.ok, true);
    if (changed.ok) {
      assert.notEqual(changed.contentHash, stored.contentHash);
      assert.notEqual(changed.evidenceId, stored.evidenceId);
    }
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 2);

    const [first, second] = await Promise.all([
      persistTenantEvidenceIntake(request({ periodStart: '2026-09-08', periodEnd: '2026-09-14', metrics: [metric('userCount', 'AVAILABLE', 3)] })),
      persistTenantEvidenceIntake(request({ periodStart: '2026-09-08', periodEnd: '2026-09-14', metrics: [metric('userCount', 'AVAILABLE', 3)] })),
    ]);
    assert.equal(first.ok && second.ok, true);
    if (first.ok && second.ok) assert.equal(first.evidenceId, second.evidenceId);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT, periodStart: '2026-09-08' } }), 1);
    assert.equal(await prisma.juryAuditEvent.count({ where: { tenantId: TENANT, action: TENANT_INTAKE_AUDIT } }), 3);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: FOREIGN } }), 0);
    assert.equal(await prisma.juryNormalizedMetric.count({ where: { tenantId: FOREIGN } }), 0);
    const afterReject = await persistTenantEvidenceIntake(request({ metrics: [metric('acme.routes', 'AVAILABLE', 1)] }));
    assert.equal(afterReject.ok, false);
    assert.equal(await prisma.juryEvidence.count({ where: { tenantId: TENANT } }), 3);
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

test('intake source does not read host data or the aisle adapter', () => {
  const files = [
    'src/lib/jury-product/tenant-evidence-intake.ts',
    'src/lib/jury-product/tenant-evidence-intake-store.ts',
  ];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.equal(source.includes('buildEvidencePackFromDb'), false, file);
    assert.equal(source.includes('attachGa4Evidence'), false, file);
    assert.equal(source.includes('runAisleAdapter'), false, file);
    assert.equal(source.includes('prisma.user'), false, file);
    assert.equal(source.includes('prisma.post'), false, file);
    assert.equal(source.includes('prisma.comment'), false, file);
    assert.equal(source.includes('GA4_PROPERTY_ID'), false, file);
    assert.equal(source.includes('GA4_SERVICE_ACCOUNT'), false, file);
    assert.equal(source.includes('GOOGLE_APPLICATION_CREDENTIALS'), false, file);
  }
});

const STORED: DeclaredMetricInput[] = [
  metric('newUsersLast7d', 'AVAILABLE', 0),
  metric('userCount', 'AVAILABLE', 12),
  metric('activeUsersLast7d', 'AVAILABLE', null),
  metric('postCount', 'AVAILABLE', Number.NaN),
  metric('postsLast7d', 'AVAILABLE', Number.POSITIVE_INFINITY),
  metric('commentsLast7d', 'NOT_MEASURED', 4),
  metric('viewsLast7d', 'NOT_AVAILABLE', 4),
  metric('totalViews', 'PERMISSION_DENIED', 4),
  metric('commentCount', 'COLLECTION_FAILED', 4),
];

function request(overrides: Partial<TenantEvidenceIntakeInput>): TenantEvidenceIntakeInput {
  return {
    userId: owner.userId,
    memberships: [owner],
    connectionId: CONN,
    scopeId: SCOPE,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    timezone: 'Asia/Seoul',
    metrics: STORED,
    sourceSystem: 'FILE',
    sourceRef: 'caller-declared',
    adapterKey: 'declared',
    adapterVersion: 'v1',
    now: NOW,
    ...overrides,
  };
}

function metric(name: string, availability: string, value: number | null): DeclaredMetricInput {
  return { metric: name, availability, value };
}

function declaredHash(value: number | null): string {
  const built = buildDeclaredEvidence({
    tenantId: TENANT,
    connectionId: CONN,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    metrics: [{ metric: 'userCount', availability: 'AVAILABLE', value }],
    sourceSystem: 'FILE',
    sourceRef: 'caller-declared',
    adapterKey: 'declared',
    adapterVersion: 'v1',
    now: NOW,
    grants: [{ resource: 'metric:userCount', mode: 'READ' }],
  });
  assert.equal(built.ok, true);
  return built.ok ? built.evidence.contentHash : '';
}

function membership(id: string, tenantId: string, userId: string, role: JuryMembership['role']): JuryMembership {
  return { id, tenantId, userId, role, createdAt: NOW };
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
  await scope(prisma, SCOPE, TENANT, CONN, 'APPROVED', GRANTS);
  await scope(prisma, SCOPE_PROPOSED, TENANT, CONN, 'PROPOSED', GRANTS);
  await scope(prisma, SCOPE_REVOKED, TENANT, CONN, 'REVOKED', GRANTS);
  await scope(prisma, SCOPE_OTHER, TENANT, CONN_B, 'APPROVED', GRANTS);
  await scope(prisma, FOREIGN_SCOPE, FOREIGN, FOREIGN_CONN, 'APPROVED', GRANTS);
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

async function scope(
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
    where: { username: { in: ['phase45-owner', 'phase45-member', 'phase45-auditor'] } },
  });
}
