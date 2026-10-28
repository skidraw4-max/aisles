/**
 * AGG-01 (RM-02): the single display aggregation for a review result.
 * Backend loaders and every UI consumer render ONLY this output; no UI-side recounting.
 * Pure function: reads stored values, never changes judging logic, never calls the core.
 *
 * Rules: /workspace plan "metric-rules" (M-001..M-018) and consistency cases CT-01..CT-12.
 * - Missing data is never shown as "no problem": it gets an explicit UNAVAILABLE / NONE_RECORDED state.
 * - AI inference, confirmed and unverified claims stay separate.
 * - No composite score (M-012 is withheld until D-07).
 * - VERIFIED_REAL is never derived here; it is only echoed when already stored.
 */
import type { JuryResultSourceValue } from './llm-call-log';

export const DISPLAY_METRIC_TRACE = {
  'M-002': { rq: 'RQ-007', ui: ['UI-05'], tests: ['CT-01', 'CT-12'] },
  'M-003': { rq: 'RQ-006', ui: ['UI-05'], tests: ['CT-01', 'CT-07'] },
  'M-004': { rq: 'RQ-008', ui: ['UI-05'], tests: ['CT-09'] },
  'M-005': { rq: 'RQ-007', ui: ['UI-05'], tests: ['CT-08'] },
  'M-006/007': { rq: 'RQ-006', ui: ['UI-05'], tests: [] },
  'M-008': { rq: 'RQ-008', ui: ['UI-05'], tests: ['CT-04', 'CT-09'] },
  'M-009': { rq: 'RQ-009', ui: ['UI-05'], tests: ['CT-05'] },
  'M-012': { rq: '-', ui: [], tests: [] },
  'M-014': { rq: 'RQ-002', ui: ['UI-04'], tests: ['CT-11'] },
  'M-015': { rq: 'RQ-003', ui: ['UI-05', 'UI-04'], tests: ['CT-10'] },
  'M-016': { rq: 'RQ-007', ui: ['UI-05'], tests: ['CT-02', 'CT-03', 'CT-08'] },
  'M-017': { rq: 'RQ-007', ui: ['UI-05'], tests: [] },
} as const;

export type DisplayFlag =
  | 'DECISION_PROBLEM_MISMATCH'
  | 'DECISION_REVISION_MISMATCH'
  | 'NO_CLAIMS'
  | 'NO_EVIDENCE'
  | 'SCHEMA_INVALID'
  | 'NON_REAL_SOURCE'
  | 'UNKNOWN_SOURCE'
  | 'DUPLICATE_CLAIM'
  | 'DUPLICATE_PROBLEM'
  | 'NO_RESULT'
  | 'PARTIAL_CONFIRMATION'
  | 'STRENGTH_COUNT_MISMATCH';

export const DISPLAY_FLAG_LABELS: Record<DisplayFlag, string> = {
  DECISION_PROBLEM_MISMATCH: '결론과 문제 목록이 일치하지 않아요',
  DECISION_REVISION_MISMATCH: '결론과 수정 필요 표시가 일치하지 않아요',
  NO_CLAIMS: '주장 기록 없음 (0건 확인이 아님)',
  NO_EVIDENCE: '근거 미연결 — 결론 표시 보류',
  SCHEMA_INVALID: '결과 형식 오류 — 결론 불가',
  NON_REAL_SOURCE: '실모델 결과가 아니에요 (집계 제외)',
  UNKNOWN_SOURCE: '출처 미기록(과거) — 실모델로 확인되지 않음',
  DUPLICATE_CLAIM: '중복 주장을 1회로 집계했어요',
  DUPLICATE_PROBLEM: '중복 문제를 1회로 집계했어요',
  NO_RESULT: '결과 없음',
  PARTIAL_CONFIRMATION: '일부 주장만 확인되었어요',
  STRENGTH_COUNT_MISMATCH: '근거 강도는 판단 불가인데 부족한 근거가 기록되지 않았어요',
};

export const RESULT_SOURCE_LABELS: Record<JuryResultSourceValue, string> = {
  REAL_MODEL: '실모델 실행(미검증)',
  MOCK: 'Mock 결과',
  FIXTURE: 'Fixture 결과',
  UNKNOWN_LEGACY: '출처 미기록(과거)',
  VERIFIED_REAL: '실모델 결과',
};

const DECISION_LABELS: Record<string, string> = { ACCEPT: '수용', VERIFY: '확인 필요', REWORD: '수정 필요' };
const EVIDENCE_STRENGTH_LABELS: Record<string, string> = { strong: '충분', moderate: '보통', unknown: '판단 불가' };
const CLAIM_STRENGTH_LABELS: Record<string, string> = { weak: '약함', strong: '강함', extreme: '과도함' };
/** RM-20 phase 1 (I-024): shown instead of a claim-strength label when the request had no input claim. */
export const NO_INPUT_CLAIM_LABEL = '주장 입력 없음';
/**
 * RM-20 phase 1 (I-024): was a claim entered on the request?
 * ENTERED: CLAIM_VALIDATION or a non-blank claim. NONE: request loaded, no claim, not CLAIM_VALIDATION.
 * UNKNOWN: caller did not load request.claim (undefined) -> previous behaviour, label unchanged.
 */
export type ClaimInputState = 'ENTERED' | 'NONE' | 'UNKNOWN';

export function claimInputState(request: ReviewDisplayInput['request']): ClaimInputState {
  if (!request || request.claim === undefined) return 'UNKNOWN';
  if (request.reviewType === 'CLAIM_VALIDATION') return 'ENTERED';
  return typeof request.claim === 'string' && request.claim.trim().length > 0 ? 'ENTERED' : 'NONE';
}
const SOURCES = new Set<string>(['REAL_MODEL', 'MOCK', 'FIXTURE', 'UNKNOWN_LEGACY', 'VERIFIED_REAL']);

export type ReviewDisplayInput = {
  result: {
    id: string;
    boardRunId?: string | null;
    expectedDecision: string;
    finalSurface: unknown;
    evidenceStrength?: string | null;
    claimStrength?: string | null;
    revisionRequired?: boolean | null;
    conflictDetected?: boolean | null;
    overclaimDetected?: boolean | null;
  } | null;
  request?: {
    status?: string | null;
    failureReason?: string | null;
    resultSource?: string | null;
    /** RM-20 phase 1: stored request input. claim undefined = not loaded (UNKNOWN); null/'' = no claim. */
    reviewType?: string | null;
    claim?: string | null;
  } | null;
  /** undefined = caller did not load evidence (scope unknown); null = no evidence linked. */
  evidence?: { id: string; metricIds?: readonly string[]; metrics?: readonly { availability: string; metric?: string }[] } | null;
};

export type CountState = 'LISTED' | 'NONE_LISTED' | 'UNAVAILABLE';

export type ReviewDisplayModel = {
  resultId: string | null;
  source: { value: JuryResultSourceValue; label: string; countsTowardAggregates: boolean; inferredFromLegacy: boolean };
  execution: { status: string | null; failureReason: string | null };
  schemaValid: boolean;
  decision: { raw: string | null; label: string; withheld: boolean; withheldReason: DisplayFlag | null };
  problems: { state: CountState; count: number | null; items: string[]; severity: null; severityNote: string | null };
  claims: {
    state: 'RECORDED' | 'NONE_RECORDED' | 'UNAVAILABLE';
    supported: string[];
    partial: string[];
    unverified: string[];
    counts: { supported: number; partial: number; unverified: number } | null;
  };
  /** Same function feeds the banner and the count (CT-05). null = cannot be counted. */
  missingEvidenceCount: number | null;
  aiInference: { label: 'AI 추정'; expectedUserEffect: string | null; risk: string | null };
  scope: { state: 'LINKED' | 'UNLINKED' | 'NOT_LOADED'; metricCount: number | null; uncheckedCount: number | null; /** RM-07 미검사 목록: same source as uncheckedCount. */ unchecked: string[] };
  /** claim: claim-strength label, or NO_INPUT_CLAIM_LABEL when claimInput is NONE (I-024: no definite strength without an input claim). */
  strength: { evidence: string | null; claim: string | null };
  /** RM-20 phase 1 (I-024). Display only; stored claimStrength and judging are unchanged. */
  claimInput: ClaimInputState;
  committee: { conflictDetected: boolean | null; overclaimDetected: boolean | null };
  /** M-012: never computed until D-07. */
  compositeScore: null;
  flags: DisplayFlag[];
};

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return value as string[];
}

function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function dedupe(items: readonly string[], seen: Set<string>): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const item of items) {
    const key = norm(item);
    if (!key) continue;
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    kept.push(item);
  }
  return { kept, dropped };
}

export function resolveResultSource(
  stored: string | null | undefined,
  boardRunId: string | null | undefined,
): { value: JuryResultSourceValue; inferredFromLegacy: boolean } {
  if (stored && SOURCES.has(stored) && stored !== 'UNKNOWN_LEGACY') {
    return { value: stored as JuryResultSourceValue, inferredFromLegacy: false };
  }
  // SRC-03: legacy fixture rows are recognisable by their boardRunId prefix.
  if (typeof boardRunId === 'string' && /^fixture[-_]/i.test(boardRunId)) {
    return { value: 'FIXTURE', inferredFromLegacy: true };
  }
  return { value: 'UNKNOWN_LEGACY', inferredFromLegacy: stored == null || stored === 'UNKNOWN_LEGACY' };
}

export function buildReviewDisplayModel(input: ReviewDisplayInput): ReviewDisplayModel {
  const flags = new Set<DisplayFlag>();
  const result = input.result;
  const source = resolveResultSource(input.request?.resultSource ?? null, result?.boardRunId ?? null);
  if (source.value === 'MOCK' || source.value === 'FIXTURE') flags.add('NON_REAL_SOURCE');
  if (source.value === 'UNKNOWN_LEGACY') flags.add('UNKNOWN_SOURCE');
  const execution = { status: input.request?.status ?? null, failureReason: input.request?.failureReason ?? null };
  const claimInput = claimInputState(input.request);

  const emptyModel = (flag: DisplayFlag, schemaValid: boolean): ReviewDisplayModel => ({
    resultId: result?.id ?? null,
    source: { ...source, label: RESULT_SOURCE_LABELS[source.value], countsTowardAggregates: source.value === 'VERIFIED_REAL' },
    execution,
    schemaValid,
    decision: { raw: result?.expectedDecision ?? null, label: flag === 'NO_RESULT' ? '결과 없음' : '결론 불가', withheld: true, withheldReason: flag },
    problems: { state: 'UNAVAILABLE', count: null, items: [], severity: null, severityNote: null },
    claims: { state: 'UNAVAILABLE', supported: [], partial: [], unverified: [], counts: null },
    missingEvidenceCount: null,
    aiInference: { label: 'AI 추정', expectedUserEffect: null, risk: null },
    scope: { state: 'NOT_LOADED', metricCount: null, uncheckedCount: null, unchecked: [] },
    strength: { evidence: null, claim: null },
    claimInput,
    committee: { conflictDetected: null, overclaimDetected: null },
    compositeScore: null,
    flags: [...flags, flag],
  });

  if (!result) return emptyModel('NO_RESULT', false);
  const surface = result.finalSurface && typeof result.finalSurface === 'object' && !Array.isArray(result.finalSurface)
    ? (result.finalSurface as Record<string, unknown>)
    : null;
  const top = surface ? strings(surface.topProblems) : null;
  const sup = surface ? strings(surface.supportedClaims) : null;
  const part = surface ? strings(surface.partiallySupportedClaims) : null;
  const hyp = surface ? strings(surface.hypotheses) : null;
  const decisionKnown = Object.hasOwn(DECISION_LABELS, result.expectedDecision);
  if (!surface || !top || !sup || !part || !hyp || !decisionKnown) return emptyModel('SCHEMA_INVALID', false);

  // M-003 (CT-07): problems are strings without severity.
  const problemSummary = summarizeProblems(result.expectedDecision, top);
  for (const flag of problemSummary.flags) flags.add(flag);
  const problems = { kept: problemSummary.items };
  const problemState: CountState = problemSummary.state;

  // M-005/M-016 (CT-08): a claim counts once, at its highest confirmation stage.
  const seen = new Set<string>();
  const s = dedupe(sup, seen);
  const p = dedupe(part, seen);
  const h = dedupe(hyp, seen);
  if (s.dropped + p.dropped + h.dropped > 0) flags.add('DUPLICATE_CLAIM');
  const claimTotal = s.kept.length + p.kept.length + h.kept.length;
  if (claimTotal === 0) flags.add('NO_CLAIMS');
  else if (p.kept.length + h.kept.length > 0) flags.add('PARTIAL_CONFIRMATION');

  // M-002 (CT-12); CT-01 is handled in summarizeProblems.
  if (result.revisionRequired === true && result.expectedDecision === 'ACCEPT') flags.add('DECISION_REVISION_MISMATCH');

  // M-008/M-004 (CT-09): unlinked evidence withholds the verdict.
  let scope: ReviewDisplayModel['scope'] = { state: 'NOT_LOADED', metricCount: null, uncheckedCount: null, unchecked: [] };
  if (input.evidence === null) {
    scope = { state: 'UNLINKED', metricCount: 0, uncheckedCount: null, unchecked: [] };
  } else if (input.evidence) {
    const ids = input.evidence.metricIds ?? [];
    const metrics = input.evidence.metrics ?? [];
    scope = ids.length === 0 && metrics.length === 0
      ? { state: 'UNLINKED', metricCount: 0, uncheckedCount: null, unchecked: [] }
      : (() => {
          // M-008: 미검사 = availability≠AVAILABLE, plus listed metricIds with no measurement row.
          const measured = new Set(metrics.map((m) => m.metric).filter((m): m is string => typeof m === 'string'));
          const unchecked = [
            ...metrics.filter((m) => m.availability !== 'AVAILABLE').map((m) => m.metric ?? '(이름 없는 지표)'),
            ...(measured.size > 0 || metrics.length === 0 ? ids.filter((id) => !measured.has(id)) : []),
          ];
          return {
            state: 'LINKED' as const,
            metricCount: Math.max(ids.length, metrics.length),
            uncheckedCount: unchecked.length,
            unchecked,
          };
        })();
  }
  if (scope.state === 'UNLINKED') flags.add('NO_EVIDENCE');
  const withheld = scope.state === 'UNLINKED';

  // I-016 / CT-05: the strength banner and the missing-evidence count come from this one function.
  const missingCount = claimTotal === 0 ? null : p.kept.length + h.kept.length;
  if (result.evidenceStrength === 'unknown' && (missingCount === null || missingCount === 0)) flags.add('STRENGTH_COUNT_MISMATCH');
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
  return {
    resultId: result.id,
    source: { ...source, label: RESULT_SOURCE_LABELS[source.value], countsTowardAggregates: source.value === 'VERIFIED_REAL' },
    execution,
    schemaValid: true,
    decision: {
      raw: result.expectedDecision,
      label: DECISION_LABELS[result.expectedDecision]!,
      withheld,
      withheldReason: withheld ? 'NO_EVIDENCE' : null,
    },
    problems: {
      state: problemState,
      count: problems.kept.length,
      items: problems.kept,
      severity: null,
      severityNote: problems.kept.length > 0 ? `심각도 미기록 ${problems.kept.length}건` : null,
    },
    claims: {
      state: claimTotal === 0 ? 'NONE_RECORDED' : 'RECORDED',
      supported: s.kept,
      partial: p.kept,
      unverified: h.kept,
      counts: claimTotal === 0 ? null : { supported: s.kept.length, partial: p.kept.length, unverified: h.kept.length },
    },
    missingEvidenceCount: missingCount,
    aiInference: { label: 'AI 추정', expectedUserEffect: text(surface.expectedUserEffect), risk: text(surface.risk) },
    scope,
    strength: {
      evidence: result.evidenceStrength ? EVIDENCE_STRENGTH_LABELS[result.evidenceStrength] ?? null : null,
      claim: claimInput === 'NONE'
        ? NO_INPUT_CLAIM_LABEL
        : result.claimStrength ? CLAIM_STRENGTH_LABELS[result.claimStrength] ?? null : null,
    },
    claimInput,
    committee: { conflictDetected: result.conflictDetected ?? null, overclaimDetected: result.overclaimDetected ?? null },
    compositeScore: null,
    flags: [...flags],
  };
}

export type ProblemSummary = {
  state: CountState;
  count: number | null;
  items: string[];
  severityNote: string | null;
  /** Text to show when there is no list. Never "없음"/"no problem". */
  emptyText: string | null;
  flags: DisplayFlag[];
};

/**
 * AGG-01 M-003 for screens that only carry a decision + topProblems (operations, onboarding).
 * Shared with buildReviewDisplayModel so every screen counts the same way.
 */
export function summarizeProblems(decision: string | null | undefined, topProblems: unknown): ProblemSummary {
  const list = strings(topProblems);
  if (!list) {
    return { state: 'UNAVAILABLE', count: null, items: [], severityNote: null, emptyText: '집계 불가', flags: ['SCHEMA_INVALID'] };
  }
  const flags: DisplayFlag[] = [];
  const { kept, dropped } = dedupe(list, new Set<string>());
  if (dropped > 0) flags.push('DUPLICATE_PROBLEM');
  if (kept.length === 0 && decision && decision !== 'ACCEPT') flags.push('DECISION_PROBLEM_MISMATCH');
  return {
    state: kept.length > 0 ? 'LISTED' : 'NONE_LISTED',
    count: kept.length,
    items: kept,
    severityNote: kept.length > 0 ? `심각도 미기록 ${kept.length}건` : null,
    emptyText: kept.length > 0 ? null : flags.includes('DECISION_PROBLEM_MISMATCH') ? '문제 목록 없음 — 결론과 불일치' : '문제 목록 없음',
    flags,
  };
}

/** Catalog rows (console view) -> display model. Used by the list and home screens. */
export function displayModelForCatalogRow(
  result: {
    id: string;
    boardRunId?: string | null;
    expectedDecision: string;
    finalSurface: unknown;
    evidenceStrength?: string | null;
    claimStrength?: string | null;
    revisionRequired?: boolean | null;
    conflictDetected?: boolean | null;
    overclaimDetected?: boolean | null;
  },
  request: { status?: string | null; resultSource?: string | null; failureReason?: string | null; evidenceId?: string | null } | null,
  evidenceRows?: readonly { id: string; metricIds?: readonly string[] | unknown }[],
): ReviewDisplayModel {
  let evidence: ReviewDisplayInput['evidence'];
  if (evidenceRows && request) {
    const row = request.evidenceId ? evidenceRows.find((item) => item.id === request.evidenceId) : undefined;
    // Not visible to this reader (or not loaded) is NOT the same as unlinked: keep it NOT_LOADED.
    if (!request.evidenceId) evidence = null;
    else if (row) {
      evidence = { id: row.id, metricIds: Array.isArray(row.metricIds) ? row.metricIds.filter((id): id is string => typeof id === 'string') : [] };
    }
  }
  return buildReviewDisplayModel({ result, request, evidence });
}

export type ReviewDisplaySummary = {
  total: number;
  /** Only VERIFIED_REAL results count toward aggregates (currently expected 0). */
  aggregatable: number;
  realUnverified: number;
  nonReal: number;
  unknownSource: number;
  withWarnings: number;
};

export function summarizeDisplayModels(models: readonly ReviewDisplayModel[]): ReviewDisplaySummary {
  return {
    total: models.length,
    aggregatable: models.filter((m) => m.source.countsTowardAggregates).length,
    realUnverified: models.filter((m) => m.source.value === 'REAL_MODEL').length,
    nonReal: models.filter((m) => m.source.value === 'MOCK' || m.source.value === 'FIXTURE').length,
    unknownSource: models.filter((m) => m.source.value === 'UNKNOWN_LEGACY').length,
    withWarnings: models.filter((m) =>
      m.flags.some((f) => f !== 'UNKNOWN_SOURCE' && f !== 'NON_REAL_SOURCE' && f !== 'PARTIAL_CONFIRMATION'),
    ).length,
  };
}

/**
 * RM-02b: decision-cycle status label for the automation screen. A cycle stays ACTIVE while a
 * human decision is pending; that is not "automation running" when the auto loop is off.
 */
export function cycleStatusLabel(status: string, loopEnabled: boolean): string {
  if (status === 'ACTIVE') return loopEnabled ? '진행 중 (자동 Loop 켜짐)' : '결정 대기 (자동 실행 아님)';
  if (status === 'COMPLETED') return '완료';
  if (status === 'BLOCKED') return '중단됨';
  return status;
}

export type ImprovementSourceBreakdown = {
  /** M-018: tasks grouped by the source of the review result they came from (read-only link task -> result -> request). */
  verifiedReal: number;
  realUnverified: number;
  nonReal: number;
  unknownSource: number;
  /** Result or request not visible/loaded: link cannot be confirmed (not counted as real). */
  unlinked: number;
};

export function improvementSourceBreakdown(
  tasks: readonly { reviewResultId: string }[],
  results: readonly { id: string; reviewRequestId: string; boardRunId?: string | null }[],
  requests: readonly { id: string; resultSource?: string | null }[],
): ImprovementSourceBreakdown {
  const out: ImprovementSourceBreakdown = { verifiedReal: 0, realUnverified: 0, nonReal: 0, unknownSource: 0, unlinked: 0 };
  for (const task of tasks) {
    const result = results.find((row) => row.id === task.reviewResultId);
    const request = result ? requests.find((row) => row.id === result.reviewRequestId) : undefined;
    if (!result || !request) {
      out.unlinked += 1;
      continue;
    }
    const source = resolveResultSource(request.resultSource ?? null, result.boardRunId ?? null).value;
    if (source === 'VERIFIED_REAL') out.verifiedReal += 1;
    else if (source === 'REAL_MODEL') out.realUnverified += 1;
    else if (source === 'MOCK' || source === 'FIXTURE') out.nonReal += 1;
    else out.unknownSource += 1;
  }
  return out;
}
