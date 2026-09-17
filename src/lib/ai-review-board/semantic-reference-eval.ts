/**
 * v9 Semantic Judge Reference Evaluation — human Expected vs deterministic Judge.
 * TP/FP/TN/FN and accuracy metrics apply ONLY to this regression fixture path.
 * Live Gemini runs must NOT invent Expected or classic TP/FP from this set.
 *
 * Browser-safe: no node:fs — fixture is bundled via JSON import.
 */
import embeddedFixture from '../../../tests/fixtures/ai-review-board/semantic-reference-cases.json';
import { buildStubEvidencePack } from './evidence-pack';
import {
  adjudicateClaimDeterministic,
  collectOverlayFlags,
  compareToReference,
  type ReferenceExpectedClassification,
} from './semantic-judge';
import type {
  ClaimEvidenceType,
  ClaimSupportLevel,
  EvidencePack,
  EvidenceRelation,
  JudgeRecommendedAction,
  JudgeVerdict,
  OverclaimRisk,
  SemanticLeapType,
} from './types';
import {
  isClaimEvidenceType,
  isClaimSupportLevel,
  isEvidenceRelation,
  isJudgeRecommendedAction,
  isOverclaimRisk,
  isSemanticLeapType,
  judgeActionsEquivalent,
  type CalibrationJudgeMismatchType,
} from './types';

export type ReferenceEvidenceEntry = {
  ref: string;
  value: unknown;
};

export type SemanticReferenceCase = {
  id: string;
  category: string;
  evidence: ReferenceEvidenceEntry[];
  claim: string;
  expected: {
    evidenceType: ClaimEvidenceType;
    supportLevel: ClaimSupportLevel;
    evidenceRelation: EvidenceRelation;
    overclaimRisk: OverclaimRisk;
    semanticLeap: SemanticLeapType;
  };
  expectedAction: JudgeRecommendedAction;
  rationale: string;
  chairmanProbe?: boolean;
};

export type ReferenceCaseResult = {
  id: string;
  category: string;
  claim: string;
  expected: SemanticReferenceCase['expected'];
  actual: {
    evidenceType: ClaimEvidenceType;
    supportLevel: ClaimSupportLevel;
    evidenceRelation: EvidenceRelation;
    overclaimRisk: OverclaimRisk;
    semanticLeap: SemanticLeapType;
    recommendedAction: JudgeRecommendedAction;
  };
  overlayFlags: string[];
  match: {
    classification: boolean;
    support: boolean;
    evidenceRelation: boolean;
    overclaimRisk: boolean;
    semanticLeap: boolean;
    action: boolean;
  };
  verdict: JudgeVerdict;
  reason: string;
};

export type ReferenceEvalMetrics = {
  cases: number;
  classificationAccuracy: number;
  supportAccuracy: number;
  evidenceRelationAccuracy: number;
  overclaimPrecision: number | null;
  overclaimRecall: number | null;
  unknownNegativeRecall: number | null;
  causalLeapRecall: number | null;
  trendLeapRecall: number | null;
  globalConclusionRecall: number | null;
  techQualityRecall: number | null;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  ambiguous: number;
};

export type ReferenceEvalReport = {
  results: ReferenceCaseResult[];
  metrics: ReferenceEvalMetrics;
};

function rate(ok: number, total: number): number {
  return total === 0 ? 0 : ok / total;
}

function recallForLeap(
  results: ReferenceCaseResult[],
  leap: SemanticLeapType,
): number | null {
  const expected = results.filter((r) => r.expected.semanticLeap === leap);
  if (expected.length === 0) return null;
  const hit = expected.filter((r) => r.actual.semanticLeap === leap).length;
  return hit / expected.length;
}

/** Apply fixture evidence entries onto a stub EvidencePack. */
export function evidencePackFromReferenceEntries(
  entries: ReferenceEvidenceEntry[],
): EvidencePack {
  const aggregates: Record<string, number | null | Record<string, number>> = {
    userCount: 14,
    usersLast7d: 0,
    newUsersLast7d: 0,
    activeUsersLast7d: null,
    postCount: 3369,
    postsLast7d: 141,
    commentsLast7d: 0,
    viewsLast7d: null,
    totalViews: 1000,
    commentCount: 0,
    postsByCategory: {},
  };
  const postsByCategory: Record<string, number> = {};
  for (const e of entries) {
    if (e.ref.startsWith('aggregates.postsByCategory.')) {
      const cat = e.ref.slice('aggregates.postsByCategory.'.length);
      if (typeof e.value === 'number') postsByCategory[cat] = e.value;
      continue;
    }
    if (e.ref.startsWith('aggregates.')) {
      const key = e.ref.slice('aggregates.'.length);
      aggregates[key] = e.value as number | null;
    }
  }
  if (Object.keys(postsByCategory).length) {
    aggregates.postsByCategory = postsByCategory;
  }
  return buildStubEvidencePack({
    aggregates: aggregates as EvidencePack['aggregates'],
  });
}

export function loadSemanticReferenceCases(
  fixture?: { cases?: unknown[] },
): SemanticReferenceCase[] {
  const raw = fixture ?? (embeddedFixture as { cases?: unknown[] });
  if (!Array.isArray(raw.cases)) {
    throw new Error('semantic-reference-cases.json: missing cases[]');
  }
  return raw.cases.map((item, idx) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const exp = (o.expected && typeof o.expected === 'object'
      ? o.expected
      : {}) as Record<string, unknown>;
    const evidenceType = exp.evidenceType;
    const supportLevel = exp.supportLevel;
    const evidenceRelation = exp.evidenceRelation;
    const overclaimRisk = exp.overclaimRisk;
    const semanticLeap = exp.semanticLeap;
    const expectedAction = o.expectedAction;
    if (!isClaimEvidenceType(evidenceType)) {
      throw new Error(`case[${idx}]: invalid evidenceType`);
    }
    if (!isClaimSupportLevel(supportLevel)) {
      throw new Error(`case[${idx}]: invalid supportLevel`);
    }
    if (!isEvidenceRelation(evidenceRelation)) {
      throw new Error(`case[${idx}]: invalid evidenceRelation`);
    }
    if (!isOverclaimRisk(overclaimRisk)) {
      throw new Error(`case[${idx}]: invalid overclaimRisk`);
    }
    if (!isSemanticLeapType(semanticLeap)) {
      throw new Error(`case[${idx}]: invalid semanticLeap`);
    }
    if (!isJudgeRecommendedAction(expectedAction)) {
      throw new Error(`case[${idx}]: invalid expectedAction`);
    }
    if (typeof o.id !== 'string' || typeof o.claim !== 'string') {
      throw new Error(`case[${idx}]: id/claim required`);
    }
    return {
      id: o.id,
      category: typeof o.category === 'string' ? o.category : 'UNKNOWN',
      evidence: Array.isArray(o.evidence)
        ? (o.evidence as ReferenceEvidenceEntry[])
        : [],
      claim: o.claim,
      expected: {
        evidenceType,
        supportLevel,
        evidenceRelation,
        overclaimRisk,
        semanticLeap,
      },
      expectedAction,
      rationale: typeof o.rationale === 'string' ? o.rationale : '',
      chairmanProbe: o.chairmanProbe === true,
    };
  });
}

export function evaluateReferenceCase(c: SemanticReferenceCase): ReferenceCaseResult {
  const pack = evidencePackFromReferenceEntries(c.evidence);
  const refs = c.evidence.map((e) => e.ref);
  const adj = adjudicateClaimDeterministic(c.claim, pack, refs);
  const overlayFlags = collectOverlayFlags({
    claimText: c.claim,
    evidence: pack,
    evidenceRefs: refs,
    judgeReason: adj.judgeReason,
    leapType: adj.semanticLeap.type,
  });
  const expectedRef: ReferenceExpectedClassification = {
    evidenceType: c.expected.evidenceType,
    supportLevel: c.expected.supportLevel,
    evidenceRelation: c.expected.evidenceRelation,
    overclaimRisk: c.expected.overclaimRisk,
    semanticLeapType: c.expected.semanticLeap,
  };
  const verdict = compareToReference(
    adj.classification,
    expectedRef,
    adj.semanticLeap.type,
  );
  const match = {
    classification:
      adj.classification.evidenceType === c.expected.evidenceType &&
      adj.classification.supportLevel === c.expected.supportLevel &&
      adj.classification.evidenceRelation === c.expected.evidenceRelation &&
      adj.semanticLeap.type === c.expected.semanticLeap,
    support: adj.classification.supportLevel === c.expected.supportLevel,
    evidenceRelation:
      adj.classification.evidenceRelation === c.expected.evidenceRelation,
    overclaimRisk: adj.classification.overclaimRisk === c.expected.overclaimRisk,
    semanticLeap: adj.semanticLeap.type === c.expected.semanticLeap,
    action: judgeActionsEquivalent(adj.recommendedAction, c.expectedAction),
  };
  return {
    id: c.id,
    category: c.category,
    claim: c.claim,
    expected: c.expected,
    actual: {
      evidenceType: adj.classification.evidenceType,
      supportLevel: adj.classification.supportLevel,
      evidenceRelation: adj.classification.evidenceRelation,
      overclaimRisk: adj.classification.overclaimRisk,
      semanticLeap: adj.semanticLeap.type,
      recommendedAction: adj.recommendedAction,
    },
    overlayFlags,
    match,
    verdict,
    reason: adj.judgeReason,
  };
}

export function summarizeReferenceResults(
  results: ReferenceCaseResult[],
): ReferenceEvalMetrics {
  const n = results.length;
  const classificationOk = results.filter((r) => r.match.classification).length;
  const supportOk = results.filter((r) => r.match.support).length;
  const relationOk = results.filter((r) => r.match.evidenceRelation).length;

  const expectedOverclaim = results.filter(
    (r) =>
      r.expected.overclaimRisk === 'HIGH' ||
      (r.expected.semanticLeap && r.expected.semanticLeap !== 'NONE'),
  );
  const predictedOverclaim = results.filter(
    (r) =>
      r.actual.overclaimRisk === 'HIGH' ||
      (r.actual.semanticLeap && r.actual.semanticLeap !== 'NONE'),
  );
  const tpOver = predictedOverclaim.filter((r) =>
    expectedOverclaim.some((e) => e.id === r.id),
  ).length;

  const countVerdict = (v: JudgeVerdict) =>
    results.filter((r) => r.verdict === v).length;

  return {
    cases: n,
    classificationAccuracy: rate(classificationOk, n),
    supportAccuracy: rate(supportOk, n),
    evidenceRelationAccuracy: rate(relationOk, n),
    overclaimPrecision:
      predictedOverclaim.length === 0 ? null : tpOver / predictedOverclaim.length,
    overclaimRecall:
      expectedOverclaim.length === 0 ? null : tpOver / expectedOverclaim.length,
    unknownNegativeRecall: recallForLeap(results, 'UNKNOWN_AS_NEGATIVE_EVIDENCE'),
    causalLeapRecall: recallForLeap(results, 'FACT_TO_CAUSALITY'),
    trendLeapRecall: recallForLeap(results, 'FACT_TO_TREND'),
    globalConclusionRecall: recallForLeap(results, 'FACT_TO_GLOBAL_CONCLUSION'),
    techQualityRecall: recallForLeap(results, 'TECH_STACK_TO_QUALITY'),
    truePositive: countVerdict('TRUE_POSITIVE'),
    falsePositive: countVerdict('FALSE_POSITIVE'),
    trueNegative: countVerdict('TRUE_NEGATIVE'),
    falseNegative: countVerdict('FALSE_NEGATIVE'),
    ambiguous: countVerdict('SEMANTICALLY_AMBIGUOUS'),
  };
}

export function runSemanticReferenceEvaluation(
  fixture?: { cases?: unknown[] },
): ReferenceEvalReport {
  const cases = loadSemanticReferenceCases(fixture);
  const results = cases.map(evaluateReferenceCase);
  return { results, metrics: summarizeReferenceResults(results) };
}

/** Chairman bucket probe for approved subset SEM-001/005/006/012/014 */
export type ChairmanBucket =
  | 'CONFIRMED_FACT'
  | 'SUPPORTED_INFERENCE'
  | 'PARTIALLY_SUPPORTED'
  | 'UNSUPPORTED_HYPOTHESIS'
  | 'UNKNOWN'
  | 'SEMANTIC_RISK';

export function classifyChairmanBucket(
  supportLevel: ClaimSupportLevel,
  leap: SemanticLeapType,
  evidenceType: ClaimEvidenceType,
): ChairmanBucket {
  if (leap !== 'NONE') return 'SEMANTIC_RISK';
  if (evidenceType === 'UNKNOWN' || supportLevel === 'NOT_SUPPORTED') {
    return evidenceType === 'UNKNOWN' ? 'UNKNOWN' : 'UNSUPPORTED_HYPOTHESIS';
  }
  if (supportLevel === 'PARTIALLY_SUPPORTED') return 'PARTIALLY_SUPPORTED';
  if (evidenceType === 'DIRECT_FACT') return 'CONFIRMED_FACT';
  return 'SUPPORTED_INFERENCE';
}

export type RevisionInfluenceMetrics = {
  judgeTriggeredRevision: number;
  judgeTriggeredReword: number;
  judgeTriggeredNarrow: number;
  judgeTriggeredConfidenceChange: number;
  judgeIgnoredRisk: number;
  judgeRevisionMismatch: number;
};

export function measureRevisionInfluence(input: {
  judgments: Array<{
    memberId: string;
    claimId: string;
    semanticLeap: { detected: boolean; type: SemanticLeapType };
    recommendedAction: JudgeRecommendedAction;
    judgeClassification: { overclaimRisk: OverclaimRisk };
  }>;
  revisions: Array<{
    memberId: string;
    revisionStatus: string;
    retainReason: string | null;
    revisionReason: string | null;
    confidenceBefore: number;
    confidenceAfter: number;
    changedClaims: string[];
  }>;
  mismatchClaimKeys?: string[];
}): RevisionInfluenceMetrics {
  let judgeTriggeredRevision = 0;
  let judgeTriggeredReword = 0;
  let judgeTriggeredNarrow = 0;
  let judgeTriggeredConfidenceChange = 0;
  let judgeIgnoredRisk = 0;
  const mismatch = new Set(input.mismatchClaimKeys ?? []);

  for (const j of input.judgments) {
    const risky =
      j.semanticLeap.detected ||
      j.judgeClassification.overclaimRisk === 'HIGH' ||
      j.recommendedAction !== 'NO_CHANGE';
    if (!risky) continue;
    const rev = input.revisions.find((r) => r.memberId === j.memberId);
    if (!rev) continue;
    const changed =
      rev.revisionStatus === 'PARTIAL' ||
      rev.revisionStatus === 'FULL' ||
      rev.changedClaims.includes(j.claimId);
    if (changed) {
      judgeTriggeredRevision += 1;
      if (j.recommendedAction === 'REWORD') judgeTriggeredReword += 1;
      if (j.recommendedAction === 'NARROW') judgeTriggeredNarrow += 1;
    }
    if (rev.confidenceAfter < rev.confidenceBefore) {
      judgeTriggeredConfidenceChange += 1;
    }
    const retain = `${rev.retainReason || ''}\n${rev.revisionReason || ''}`.trim();
    if (!changed && retain.length < 40) {
      judgeIgnoredRisk += 1;
    }
  }

  return {
    judgeTriggeredRevision,
    judgeTriggeredReword,
    judgeTriggeredNarrow,
    judgeTriggeredConfidenceChange,
    judgeIgnoredRisk,
    judgeRevisionMismatch: mismatch.size,
  };
}

const SUPPORT_RANK: Record<ClaimSupportLevel, number> = {
  SUPPORTED: 2,
  PARTIALLY_SUPPORTED: 1,
  NOT_SUPPORTED: 0,
};

export function compareCalibrationJudgeMismatch(
  calibration: { supportLevel: ClaimSupportLevel; evidenceRelation: string },
  judge: { supportLevel: ClaimSupportLevel; evidenceRelation: string },
): CalibrationJudgeMismatchType {
  if (
    calibration.supportLevel === judge.supportLevel &&
    calibration.evidenceRelation === judge.evidenceRelation
  ) {
    return 'NONE';
  }
  const c = SUPPORT_RANK[calibration.supportLevel];
  const j = SUPPORT_RANK[judge.supportLevel];
  if (j < c) return 'JUDGE_STRICTER';
  if (c < j) return 'CALIBRATION_STRICTER';
  return 'CALIBRATION_JUDGE_CONFLICT';
}

/** Deterministic scan of Chairman/final text for known reliability failures. */
export function scanChairmanReliability(input: {
  confirmedFacts?: string[];
  hypotheses?: string[];
  statusSummary?: string;
  supportedClaims?: string[];
  unsupportedHypothesisClaims?: string[];
}): string[] {
  const blob = [
    ...(input.confirmedFacts ?? []),
    ...(input.hypotheses ?? []),
    ...(input.supportedClaims ?? []),
    ...(input.unsupportedHypothesisClaims ?? []),
    input.statusSummary ?? '',
  ].join('\n');
  const flags: string[] = [];
  if (
    /(null|unavailable|측정).{0,40}(low|낮|dormant|inactive)/i.test(blob) ||
    /activity is low/i.test(blob)
  ) {
    flags.push('NULL_AS_LOW_ACTIVITY');
  }
  if (/(댓글\s*0|comments?\s*=?\s*0).{0,40}(전체|platform|entire).{0,20}(inactive|참여)/i.test(blob)) {
    flags.push('SINGLE_METRIC_AS_PLATFORM_INACTIVE');
  }
  if (/(Gemini|AI).{0,40}(integration|통합).{0,40}(increases?|증가|효과)/i.test(blob)) {
    flags.push('PRESENCE_AS_EFFECT');
  }
  if (/(many posts|게시글\s*수|postCount).{0,40}(quality|품질)/i.test(blob)) {
    flags.push('QUANTITY_AS_QUALITY');
  }
  if (/(2025|2026|트렌드).{0,40}(격차|gap)/i.test(blob) && !/benchmark/i.test(blob)) {
    flags.push('BENCHMARK_WITHOUT_EVIDENCE');
  }
  if (/(UI\/?UX).{0,40}(confirmed cause|원인이다|확정)/i.test(blob)) {
    flags.push('UX_HYPOTHESIS_AS_FACT');
  }
  return flags;
}
