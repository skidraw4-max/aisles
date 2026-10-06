import type { JuryActor } from './access';
import type { JuryConsoleCatalog } from './console-fixture';
import type {
  JuryAuditEvent,
  JuryEvidence,
  JuryLoopGuardPolicy,
  JuryMemberRole,
  JuryNormalizedMetric,
  JuryReviewRequest,
  JuryReviewResult,
} from './records';

const emptyPolicy: JuryLoopGuardPolicy = {
  maxIterations: null,
  maxRuntimeMs: null,
  maxCostUsd: null,
};

function byTenant<T extends { tenantId: string }>(tenantId: string, rows: readonly T[]): T[] {
  return rows.filter((row) => row.tenantId === tenantId);
}

export type JuryConsoleView = {
  tenantId: string;
  role: JuryMemberRole;
  connections: JuryConsoleCatalog['connections'];
  scopes: JuryConsoleCatalog['scopes'];
  discoveries: JuryConsoleCatalog['discoveries'];
  metrics: JuryConsoleCatalog['metrics'];
  evidence: JuryConsoleCatalog['evidence'];
  requests: JuryConsoleCatalog['requests'];
  results: JuryConsoleCatalog['results'];
  tasks: JuryConsoleCatalog['tasks'];
  executions: JuryConsoleCatalog['executions'];
  gates: JuryConsoleCatalog['gates'];
  reReviews: JuryConsoleCatalog['reReviews'];
  audit: JuryConsoleCatalog['audit'];
  loopPolicy: JuryLoopGuardPolicy;
};

export function readJuryConsole(actor: JuryActor, catalog: JuryConsoleCatalog): JuryConsoleView | null {
  if (!actor.ok) return null;
  const tenantId = actor.tenantId;
  const policy = catalog.policies.find((row) => row.tenantId === tenantId)?.policy ?? emptyPolicy;
  return {
    tenantId,
    role: actor.role,
    connections: byTenant(tenantId, catalog.connections),
    scopes: byTenant(tenantId, catalog.scopes),
    discoveries: byTenant(tenantId, catalog.discoveries),
    metrics: byTenant(tenantId, catalog.metrics),
    evidence: byTenant(tenantId, catalog.evidence),
    requests: byTenant(tenantId, catalog.requests),
    results: byTenant(tenantId, catalog.results),
    tasks: byTenant(tenantId, catalog.tasks),
    executions: byTenant(tenantId, catalog.executions),
    gates: byTenant(tenantId, catalog.gates),
    reReviews: byTenant(tenantId, catalog.reReviews),
    audit: byTenant(tenantId, catalog.audit),
    loopPolicy: policy,
  };
}

export type JuryReviewDetail = {
  result: JuryReviewResult;
  request: JuryReviewRequest | null;
  evidence: JuryEvidence | null;
  metrics: JuryNormalizedMetric[];
  audit: JuryAuditEvent[];
};

export function readJuryReviewDetail(
  actor: JuryActor,
  catalog: JuryConsoleCatalog,
  reviewResultId: string,
): JuryReviewDetail | null {
  const view = readJuryConsole(actor, catalog);
  if (!view) return null;
  const result = view.results.find((row) => row.id === reviewResultId);
  if (!result) return null;
  const request = view.requests.find((row) => row.id === result.reviewRequestId) ?? null;
  const evidence = request ? (view.evidence.find((row) => row.id === request.evidenceId) ?? null) : null;
  const metrics = evidence ? view.metrics.filter((row) => evidence.metricIds.includes(row.id)) : [];
  const audit = view.audit.filter(
    (row) => row.reviewId === result.id || (request ? row.reviewId === request.id : false),
  );
  return { result, request, evidence, metrics, audit };
}
