import { JURY_PRODUCT_DATA_ROOT } from './records';
import type {
  JuryAccessScope,
  JuryAgentExecution,
  JuryAuditEvent,
  JuryChangeGateResult,
  JuryDiscoveryResult,
  JuryEvidence,
  JuryImprovementTask,
  JuryLoopGuardPolicy,
  JuryNormalizedMetric,
  JuryReReviewResult,
  JuryReviewRequest,
  JuryReviewResult,
  JuryServiceConnection,
} from './records';

const unsetPolicy: JuryLoopGuardPolicy = {
  maxIterations: null,
  maxRuntimeMs: null,
  maxCostUsd: null,
};

const connectionA: JuryServiceConnection = {
  id: 'conn-a',
  tenantId: 'tenant-a',
  serviceKey: 'aisle-self',
  displayName: 'AIsle 자체',
  accessMethod: 'OAUTH',
  status: 'CONNECTED',
  credentialRef: 'secret-store/conn-a',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const connectionB: JuryServiceConnection = {
  id: 'conn-b',
  tenantId: 'tenant-b',
  serviceKey: 'shop',
  displayName: '다른 조직 상점',
  accessMethod: 'API_KEY',
  status: 'CONNECTED',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const evidenceA: JuryEvidence = {
  id: 'evidence-a',
  tenantId: 'tenant-a',
  connectionId: 'conn-a',
  purpose: '가입 수 확인',
  periodStart: '2026-09-24',
  periodEnd: '2026-09-30',
  timezone: 'Asia/Seoul',
  metricIds: ['metric-signups', 'metric-sales'],
  adapterKey: 'aisle-self',
  collectedAt: '2026-10-01T00:00:00.000Z',
};

const evidenceB: JuryEvidence = {
  id: 'evidence-b',
  tenantId: 'tenant-b',
  connectionId: 'conn-b',
  purpose: '다른 조직',
  periodStart: '2026-09-24',
  periodEnd: '2026-09-30',
  timezone: 'Asia/Seoul',
  metricIds: ['metric-b'],
  adapterKey: 'shop',
  collectedAt: '2026-10-01T00:00:00.000Z',
};

const requestA: JuryReviewRequest = {
  id: 'request-a',
  tenantId: 'tenant-a',
  connectionId: 'conn-a',
  evidenceId: 'evidence-a',
  reviewType: 'CLAIM_VALIDATION',
  claim: '최근 7일 DB 신규 가입자는 0명이다.',
  mode: 'AISLE_SELF',
  status: 'COMPLETED',
  coreRootDir: JURY_PRODUCT_DATA_ROOT,
};

const requestB: JuryReviewRequest = {
  id: 'request-b',
  tenantId: 'tenant-b',
  connectionId: 'conn-b',
  evidenceId: 'evidence-b',
  reviewType: 'CLAIM_VALIDATION',
  claim: 'TENANT_B_SECRET_CLAIM',
  mode: 'EXTERNAL_SERVICE',
  status: 'COMPLETED',
  coreRootDir: JURY_PRODUCT_DATA_ROOT,
};

const resultA: JuryReviewResult = {
  id: 'review-a',
  tenantId: 'tenant-a',
  reviewRequestId: 'request-a',
  boardRunId: 'fixture-run-a',
  evidenceStrength: 'strong',
  claimStrength: 'weak',
  conflictDetected: false,
  overclaimDetected: false,
  revisionRequired: false,
  expectedDecision: 'ACCEPT',
  finalSurface: {
    statusSummary: '최근 7일 DB 신규 가입은 0명으로 측정되었다.',
    topProblems: [],
    expectedUserEffect: '',
    risk: '',
    dimensionEvidence: ['newUsersLast7d = 0'],
    supportedClaims: ['최근 7일 DB 신규 가입자는 0명이다.'],
    partiallySupportedClaims: [],
    hypotheses: [],
  },
  contractVersion: 'v9.x-ev020',
  completedAt: '2026-10-01T01:00:00.000Z',
};

const resultB: JuryReviewResult = {
  id: 'review-b',
  tenantId: 'tenant-b',
  reviewRequestId: 'request-b',
  boardRunId: 'fixture-run-b',
  evidenceStrength: 'unknown',
  claimStrength: 'weak',
  conflictDetected: false,
  overclaimDetected: false,
  revisionRequired: false,
  expectedDecision: 'ACCEPT',
  finalSurface: {
    statusSummary: 'TENANT_B_SECRET_CLAIM',
    topProblems: [],
    expectedUserEffect: '',
    risk: '',
    dimensionEvidence: [],
    supportedClaims: [],
    partiallySupportedClaims: [],
    hypotheses: [],
  },
  contractVersion: 'v9.x-ev020',
  completedAt: '2026-10-01T01:00:00.000Z',
};

export type JuryConsoleCatalog = {
  connections: JuryServiceConnection[];
  scopes: JuryAccessScope[];
  discoveries: JuryDiscoveryResult[];
  metrics: JuryNormalizedMetric[];
  evidence: JuryEvidence[];
  requests: JuryReviewRequest[];
  results: JuryReviewResult[];
  tasks: JuryImprovementTask[];
  executions: JuryAgentExecution[];
  gates: JuryChangeGateResult[];
  reReviews: JuryReReviewResult[];
  audit: JuryAuditEvent[];
  policies: Array<{ tenantId: string; policy: JuryLoopGuardPolicy }>;
};

export const JURY_CONSOLE_FIXTURE: JuryConsoleCatalog = {
  connections: [connectionA, connectionB],
  scopes: [
    {
      id: 'scope-a',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      status: 'APPROVED',
      grants: [{ resource: 'metrics.read', mode: 'READ' }],
      approvedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  discoveries: [
    {
      id: 'discovery-a',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      exploredAt: '2026-10-01T00:00:00.000Z',
      surfaces: ['API'],
      menus: ['운영 지표'],
      dataSources: ['API'],
      feasibility: 'PARTIAL',
      proposedMetrics: [{ metric: 'newUsersLast7d', reason: '기존 EvidencePack primary metric' }],
      approval: 'APPROVED',
    },
  ],
  metrics: [
    {
      id: 'metric-signups',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      evidenceId: 'evidence-a',
      metric: 'newUsersLast7d',
      value: 0,
      unit: 'COUNT',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: 'Asia/Seoul',
      sourceSystem: 'DATABASE',
      sourceRef: 'aggregates.newUsersLast7d',
      collectedAt: '2026-10-01T00:00:00.000Z',
      availability: 'AVAILABLE',
      rawPayloadRef: 'raw/signups',
      adapterKey: 'aisle-self',
      adapterVersion: '0',
      ruleId: 'identity',
    },
    {
      id: 'metric-sales',
      tenantId: 'tenant-a',
      connectionId: 'conn-a',
      evidenceId: 'evidence-a',
      metric: 'sales',
      value: 12800000,
      unit: 'KRW',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: 'Asia/Seoul',
      sourceSystem: 'API',
      sourceRef: 'total_sales',
      collectedAt: '2026-10-01T00:00:00.000Z',
      availability: 'AVAILABLE',
      rawValueText: '12,800,000원',
      rawPayloadRef: 'raw/sales',
      adapterKey: 'shop',
      adapterVersion: '0',
      ruleId: 'krw',
    },
    {
      id: 'metric-b',
      tenantId: 'tenant-b',
      connectionId: 'conn-b',
      evidenceId: 'evidence-b',
      metric: 'sales',
      value: 1,
      unit: 'KRW',
      periodStart: '2026-09-24',
      periodEnd: '2026-09-30',
      timezone: 'Asia/Seoul',
      sourceSystem: 'API',
      sourceRef: 'other',
      collectedAt: '2026-10-01T00:00:00.000Z',
      availability: 'AVAILABLE',
      rawPayloadRef: 'raw/other',
      adapterKey: 'shop',
      adapterVersion: '0',
      ruleId: 'krw',
    },
  ],
  evidence: [evidenceA, evidenceB],
  requests: [requestA, requestB],
  results: [resultA, resultB],
  tasks: [
    {
      id: 'task-a',
      tenantId: 'tenant-a',
      reviewResultId: 'review-a',
      diagnosis: '측정된 가입 0건을 제품 문장과 분리해 둔다.',
      acceptanceCriteria: ['Final surface가 측정값 0을 유지한다.'],
      status: 'OPEN',
      loopIndex: 1,
      loopPolicy: unsetPolicy,
    },
  ],
  executions: [
    {
      id: 'exec-a',
      tenantId: 'tenant-a',
      taskId: 'task-a',
      agent: 'MANUAL',
      allowedPaths: ['src/app/(root)/jury'],
      deniedPaths: ['.env', 'prisma/migrations', 'src/lib/ai-review-board', 'tests/ai-review-board/evaluation'],
      status: 'PENDING',
    },
  ],
  gates: [],
  reReviews: [],
  audit: [
    {
      id: 'audit-a',
      tenantId: 'tenant-a',
      timestamp: '2026-10-01T01:00:00.000Z',
      actor: 'user-owner',
      action: 'REVIEW_COMPLETED',
      reviewId: 'review-a',
      decision: 'ACCEPT',
      evidenceId: 'evidence-a',
    },
    {
      id: 'audit-b',
      tenantId: 'tenant-b',
      timestamp: '2026-10-01T01:00:00.000Z',
      actor: 'user-b',
      action: 'REVIEW_COMPLETED',
      reviewId: 'review-b',
      decision: 'ACCEPT',
    },
  ],
  policies: [
    { tenantId: 'tenant-a', policy: unsetPolicy },
    { tenantId: 'tenant-b', policy: unsetPolicy },
  ],
};
