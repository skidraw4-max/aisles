/**
 * AIsles Jury product Standard Contract.
 * These types sit above v9.x. They do not replace EvidencePack.
 */

export const JURY_PRODUCT_DATA_ROOT = 'data/jury-product';
export const JURY_CONSOLE_BASE_PATH = '/jury';
export const JURY_CONTRACT_VERSION = 'jury-product-v1';
export const JURY_CORE_CONTRACT_VERSION = 'v9.x-ev020';

/** Coding agent must not edit secrets, DB migrations, or the frozen v9.x core. */
export const JURY_AGENT_PATH_FLOOR = [
  '.env',
  'prisma/migrations',
  'src/lib/ai-review-board',
  'tests/ai-review-board/evaluation',
] as const;

export const JURY_MEMBER_ROLES = ['OWNER', 'ADMIN', 'REVIEWER', 'DEVELOPER', 'VIEWER'] as const;
export type JuryMemberRole = (typeof JURY_MEMBER_ROLES)[number];

export const JURY_ACCESS_METHODS = [
  'OAUTH',
  'API_KEY',
  'READ_ONLY_ACCOUNT',
  'BROWSER_SESSION',
  'FILE_UPLOAD',
] as const;
export type JuryAccessMethod = (typeof JURY_ACCESS_METHODS)[number];

export const JURY_AVAILABILITIES = [
  'AVAILABLE',
  'NOT_MEASURED',
  'NOT_AVAILABLE',
  'PERMISSION_DENIED',
  'COLLECTION_FAILED',
  'UNSUPPORTED',
] as const;
export type JuryAvailability = (typeof JURY_AVAILABILITIES)[number];

export const JURY_METRIC_UNITS = [
  'COUNT',
  'KRW',
  'PERCENT',
  'DURATION_SEC',
  'RATIO',
  'OTHER',
] as const;
export type JuryMetricUnit = (typeof JURY_METRIC_UNITS)[number];

export const JURY_SOURCE_SYSTEMS = ['DATABASE', 'GA4', 'API', 'SCREEN', 'FILE', 'OTHER'] as const;
export type JurySourceSystem = (typeof JURY_SOURCE_SYSTEMS)[number];

export const JURY_REVIEW_TYPES = ['CLAIM_VALIDATION', 'FULL_REVIEW', 'UI_UX_REVIEW'] as const;
export type JuryReviewType = (typeof JURY_REVIEW_TYPES)[number];

/** Reachable v9.x comparator outputs. Wider core unions are not stored here. */
export const JURY_EVIDENCE_STRENGTHS = ['strong', 'moderate', 'unknown'] as const;
export type JuryEvidenceStrength = (typeof JURY_EVIDENCE_STRENGTHS)[number];

export const JURY_CLAIM_STRENGTHS = ['weak', 'strong', 'extreme'] as const;
export type JuryClaimStrength = (typeof JURY_CLAIM_STRENGTHS)[number];

export const JURY_DECISIONS = ['ACCEPT', 'VERIFY', 'REWORD'] as const;
export type JuryDecision = (typeof JURY_DECISIONS)[number];

export const JURY_CONNECTION_STATUSES = [
  'DRAFT',
  'CONNECTED',
  'DISCOVERY_PENDING',
  'LIMITED',
  'DISCONNECTED',
  'ERROR',
] as const;
export type JuryConnectionStatus = (typeof JURY_CONNECTION_STATUSES)[number];

export const JURY_SCOPE_STATUSES = ['PROPOSED', 'APPROVED', 'REVOKED'] as const;
export type JuryScopeStatus = (typeof JURY_SCOPE_STATUSES)[number];

export const JURY_DISCOVERY_FEASIBILITIES = ['AVAILABLE', 'PARTIAL', 'NOT_AVAILABLE'] as const;
export type JuryDiscoveryFeasibility = (typeof JURY_DISCOVERY_FEASIBILITIES)[number];

export const JURY_APPROVALS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type JuryApproval = (typeof JURY_APPROVALS)[number];

export const JURY_REVIEW_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type JuryReviewStatus = (typeof JURY_REVIEW_STATUSES)[number];

export const JURY_TASK_STATUSES = [
  'OPEN',
  'HANDED_OFF',
  'GATED',
  'NEEDS_APPROVAL',
  'DONE',
  'STOPPED',
] as const;
export type JuryTaskStatus = (typeof JURY_TASK_STATUSES)[number];

export const JURY_STOP_REASONS = [
  'MAX_LOOPS',
  'SAME_PROBLEM',
  'MAX_TIME',
  'MAX_COST',
  'HIGH_RISK',
  'PRODUCTION_CONFIG',
  'DB_CHANGE',
  'SECURITY',
] as const;
export type JuryStopReason = (typeof JURY_STOP_REASONS)[number];

export const JURY_AGENTS = ['CURSOR', 'CLAUDE_CODE', 'MANUAL', 'OTHER'] as const;
export type JuryAgentKind = (typeof JURY_AGENTS)[number];

export const JURY_EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'BLOCKED'] as const;
export type JuryExecutionStatus = (typeof JURY_EXECUTION_STATUSES)[number];

export const JURY_RISK_FLAGS = [
  'HIGH_RISK_FILE',
  'PRODUCTION_CONFIG',
  'DB_MIGRATION',
  'SECURITY',
] as const;
export type JuryRiskFlag = (typeof JURY_RISK_FLAGS)[number];

export const JURY_GATE_RESULTS = ['PASS', 'NEEDS_APPROVAL', 'BLOCK'] as const;
export type JuryGateResult = (typeof JURY_GATE_RESULTS)[number];

/**
 * Limits are settings. null means the number is not chosen yet.
 * Auto loop stays off until every field is a finite number >= 0.
 */
export type JuryLoopGuardPolicy = {
  maxIterations: number | null;
  maxRuntimeMs: number | null;
  maxCostUsd: number | null;
};

export type JuryTenant = {
  id: string;
  name: string;
  createdAt: string;
};

/** Membership is not Prisma User.role. ADMIN does not grant tenant access. */
export type JuryMembership = {
  id: string;
  tenantId: string;
  userId: string;
  role: JuryMemberRole;
  createdAt: string;
};

export type JuryServiceConnection = {
  id: string;
  tenantId: string;
  serviceKey: string;
  displayName: string;
  accessMethod: JuryAccessMethod;
  status: JuryConnectionStatus;
  /** Key into an encrypted secret store. Not the token or password. */
  credentialRef?: string;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type JuryAccessGrant = {
  resource: string;
  mode: 'READ';
};

export type JuryAccessScope = {
  id: string;
  tenantId: string;
  connectionId: string;
  status: JuryScopeStatus;
  grants: JuryAccessGrant[];
  approvedByUserId?: string;
  approvedAt?: string;
  expiresAt?: string;
};

export type JuryDiscoveryResult = {
  id: string;
  tenantId: string;
  connectionId: string;
  exploredAt: string;
  surfaces: Array<'FRONTEND' | 'ADMIN' | 'BO' | 'API'>;
  menus: string[];
  dataSources: Array<'API' | 'SCREEN' | 'FILE' | 'STATS'>;
  feasibility: JuryDiscoveryFeasibility;
  proposedMetrics: Array<{ metric: string; reason: string }>;
  approval: JuryApproval;
  uiNotes?: string;
};

export type JuryNormalizedMetric = {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId?: string;
  metric: string;
  /** Finite number only when availability is AVAILABLE. 0 is a measurement. */
  value: number | null;
  unit: JuryMetricUnit;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  sourceSystem: JurySourceSystem;
  sourceRef: string;
  collectedAt: string;
  availability: JuryAvailability;
  rawValueText?: string;
  rawPayloadRef: string;
  adapterKey: string;
  adapterVersion: string;
  ruleId: string;
};

export type JuryEvidence = {
  id: string;
  tenantId: string;
  connectionId: string;
  purpose: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  metricIds: string[];
  apiEvidence?: Array<{ endpoint: string; payloadRef: string; requestedAt: string }>;
  uiEvidence?: Array<{ url: string; screenshotRef?: string; domRef?: string; visibleText?: string }>;
  documentEvidence?: Array<{ fileName: string; section?: string; source: string }>;
  adapterKey: string;
  collectedAt: string;
  contentHash?: string;
  piiExcluded?: boolean;
  readOnly?: boolean;
};

type JuryReviewRequestBase = {
  id: string;
  tenantId: string;
  connectionId: string;
  evidenceId: string;
  mode: 'AISLE_SELF' | 'EXTERNAL_SERVICE';
  status: JuryReviewStatus;
  /** Product runs use JURY_PRODUCT_DATA_ROOT, not data/ai-review-board. */
  coreRootDir: typeof JURY_PRODUCT_DATA_ROOT;
  requestedByUserId?: string;
};

/** A claim sentence is required only when the review exists to validate that sentence. */
export type JuryReviewRequest =
  | (JuryReviewRequestBase & { reviewType: 'CLAIM_VALIDATION'; claim: string })
  | (JuryReviewRequestBase & { reviewType: 'FULL_REVIEW' | 'UI_UX_REVIEW'; claim?: string });

export type JuryFinalSurface = {
  statusSummary: string;
  topProblems: string[];
  expectedUserEffect: string;
  risk: string;
  dimensionEvidence: string[];
  supportedClaims: string[];
  partiallySupportedClaims: string[];
  hypotheses: string[];
};

export type JuryReviewResult = {
  id: string;
  tenantId: string;
  reviewRequestId: string;
  boardRunId: string;
  evidenceStrength: JuryEvidenceStrength;
  claimStrength: JuryClaimStrength;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  expectedDecision: JuryDecision;
  finalSurface: JuryFinalSurface;
  contractVersion: typeof JURY_CORE_CONTRACT_VERSION;
  completedAt: string;
};

export type JuryImprovementTask = {
  id: string;
  tenantId: string;
  reviewResultId: string;
  diagnosis: string;
  acceptanceCriteria: string[];
  status: JuryTaskStatus;
  loopIndex: number;
  loopPolicy: JuryLoopGuardPolicy;
  parentTaskId?: string;
  stopReason?: JuryStopReason;
  taskType?: 'VERIFICATION' | 'REWORD';
  createdAt?: string;
};

export type JuryAgentExecution = {
  id: string;
  tenantId: string;
  taskId: string;
  agent: JuryAgentKind;
  allowedPaths: string[];
  deniedPaths: string[];
  status: JuryExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  estimatedCostUsd?: number;
};

export type JuryChangeGateResult = {
  id: string;
  tenantId: string;
  executionId: string;
  changedFiles: string[];
  riskFlags: JuryRiskFlag[];
  testsPassed: boolean | null;
  gate: JuryGateResult;
};

export type JuryReReviewResult = {
  id: string;
  tenantId: string;
  taskId: string;
  previousReviewResultId: string;
  nextReviewResultId: string;
  resolved: boolean;
  sameProblem: boolean;
  completedAt: string;
};

export type JuryAuditEvent = {
  id: string;
  tenantId: string;
  timestamp: string;
  actor: string;
  action: string;
  serviceKey?: string;
  accessMethod?: JuryAccessMethod;
  scopeId?: string;
  source?: string;
  evidenceId?: string;
  reviewId?: string;
  decision?: JuryDecision;
  improvementTaskId?: string;
  agent?: JuryAgentKind;
  changedFiles?: string[];
  testResult?: string;
  reReviewResultId?: string;
};

export function isClaimRequired(reviewType: JuryReviewType): boolean {
  return reviewType === 'CLAIM_VALIDATION';
}

export function validateReviewRequestShape(input: {
  reviewType: JuryReviewType;
  claim?: string | null;
}): { ok: true } | { ok: false; reason: 'CLAIM_REQUIRED' } {
  if (!isClaimRequired(input.reviewType)) return { ok: true };
  if (typeof input.claim === 'string' && input.claim.trim().length > 0) return { ok: true };
  return { ok: false, reason: 'CLAIM_REQUIRED' };
}

function isConfiguredLimit(value: number | null): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function canStartAutoLoop(policy: JuryLoopGuardPolicy): boolean {
  return (
    isConfiguredLimit(policy.maxIterations) &&
    isConfiguredLimit(policy.maxRuntimeMs) &&
    isConfiguredLimit(policy.maxCostUsd)
  );
}

export function agentDeniedPathsCoverFloor(deniedPaths: readonly string[]): boolean {
  return JURY_AGENT_PATH_FLOOR.every((prefix) => deniedPaths.includes(prefix));
}
