/**
 * v8 Semantic Judge — adjudication helpers + deterministic overlay.
 * TP/FP/TN/FN only when ReferenceExpectedClassification is provided (regression).
 * Live runs: verdict = SEMANTICALLY_AMBIGUOUS; store judgeClassification + leap + recommendedAction.
 */
import type {
  CalibratedClaim,
  ClaimCalibration,
  ClaimEvidenceType,
  ClaimSupportLevel,
  CommitteeAnalystId,
  EvidencePack,
  EvidenceRelation,
  EvidenceSemanticsMember,
  EvidenceSemanticsRow,
  JudgeRecommendedAction,
  JudgeVerdict,
  OverclaimRisk,
  RevisionRecord,
  SemanticJudgment,
  SemanticLeapType,
} from './types';
import {
  isClaimEvidenceType,
  isClaimSupportLevel,
  isEvidenceRelation,
  isJudgeRecommendedAction,
  isJudgeVerdict,
  isOverclaimRisk,
  isSemanticLeapType,
} from './types';
import { evaluateEvidenceClaimEntailment } from './evidence-claim-entailment';
import { textUsesMajorityAsGround } from './revision-quality';

export function textUsesMajorityAsJudgeGround(text: string): boolean {
  if (textUsesMajorityAsGround(text)) return true;
  return /다른\s*AI|대부분의\s*AI|all\s+AIs?\s+agree|majority\s+of\s+(the\s+)?(reviewers|ais)/i.test(
    text,
  );
}

export type ReferenceExpectedClassification = {
  evidenceType: ClaimEvidenceType;
  supportLevel: ClaimSupportLevel;
  evidenceRelation: EvidenceRelation;
  overclaimRisk: OverclaimRisk;
  semanticLeapType?: SemanticLeapType;
};

export type JudgeClassification = {
  evidenceType: ClaimEvidenceType;
  supportLevel: ClaimSupportLevel;
  evidenceRelation: EvidenceRelation;
  overclaimRisk: OverclaimRisk;
};

const MEASUREMENT_GAP_RE =
  /(측정.*(없|불가)|알\s*수\s*없|not\s+measured|unavailable|null|데이터가\s*없|측정되지)/i;
const LOW_ACTIVITY_RE =
  /(활성도가\s*낮|활동량이\s*낮|참여도가\s*(심각히\s*)?낮|휴면|dormant|low\s+activity|low\s+engagement|severely\s+low)/i;
const CAUSAL_FAIL_RE =
  /(전략이\s*실패|마케팅이\s*실패|효과가\s*없|때문에|원인|로\s*인해|caused by|due to|failed|failure)/i;
const ACQUISITION_FAIL_RE = /(획득\s*전략|유입\s*전략|acquisition).{0,30}(실패|효과\s*없|failed)/i;
const GLOBAL_ENGAGEMENT_RE =
  /(전체\s*(커뮤니티\s*)?참여|플랫폼\s*전체|overall\s+(community\s+)?engagement|community\s+participation)/i;
const TREND_RE =
  /(감소했|증가했|하락|성장하고|정체|악화|개선되고|declined|decreased|increased|worsened|improved|trend)/i;
const TECH_QUALITY_RE =
  /(확장성이\s*검증|성능이\s*우수|확장\s*가능|scalability\s+(verified|proven)|performance\s+is\s+(excellent|good))/i;
const TECH_STACK_RE = /(Vercel|PostgreSQL|Next\.js|기술\s*스택|infra|인프라)/i;

/** Deterministic adjudication of a single claim against EvidencePack (Rules R1–R8). */
export function adjudicateClaimDeterministic(
  claimText: string,
  evidence: EvidencePack,
  evidenceRefs: string[] = [],
): {
  classification: JudgeClassification;
  semanticLeap: { detected: boolean; type: SemanticLeapType };
  recommendedAction: JudgeRecommendedAction;
  missingEvidence: string[];
  judgeReason: string;
} {
  const text = claimText.trim();
  const a = evidence.aggregates;
  const missing: string[] = [];

  // Measurement gap claim (null metrics stated as unmeasured) — DIRECT
  if (
    MEASUREMENT_GAP_RE.test(text) &&
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    /(active|활성|views|조회)/i.test(text) &&
    !LOW_ACTIVITY_RE.test(text)
  ) {
    return {
      classification: {
        evidenceType: 'DIRECT_FACT',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
      },
      semanticLeap: { detected: false, type: 'NONE' },
      recommendedAction: 'NO_CHANGE',
      missingEvidence: [],
      judgeReason: 'Null metrics directly support “not measured / unavailable” wording',
    };
  }

  // UNKNOWN as negative
  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    LOW_ACTIVITY_RE.test(text) &&
    !MEASUREMENT_GAP_RE.test(text)
  ) {
    missing.push('activeUsersLast7d', 'viewsLast7d');
    return {
      classification: {
        evidenceType: 'UNKNOWN',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'UNKNOWN_AS_NEGATIVE_EVIDENCE' },
      recommendedAction: 'REWORD',
      missingEvidence: missing,
      judgeReason: 'null/UNKNOWN metrics do not entail low activity',
    };
  }

  // Dual zero newUsers+comments descriptive
  if (
    /신규.{0,20}0/.test(text) &&
    /댓글.{0,20}0/.test(text) &&
    !CAUSAL_FAIL_RE.test(text) &&
    a.newUsersLast7d === 0 &&
    a.commentsLast7d === 0
  ) {
    return {
      classification: {
        evidenceType: 'DIRECT_FACT',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
      },
      semanticLeap: { detected: false, type: 'NONE' },
      recommendedAction: 'NO_CHANGE',
      missingEvidence: [],
      judgeReason: 'Both zeros are directly measured',
    };
  }

  // newUsers=0 fact
  if (
    /신규.{0,30}(0|없|zero)/i.test(text) &&
    !TREND_RE.test(text) &&
    !ACQUISITION_FAIL_RE.test(text) &&
    !/전략|마케팅|실패|의미한다/.test(text) &&
    a.newUsersLast7d === 0
  ) {
    return {
      classification: {
        evidenceType: 'DIRECT_FACT',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
      },
      semanticLeap: { detected: false, type: 'NONE' },
      recommendedAction: 'NO_CHANGE',
      missingEvidence: [],
      judgeReason: 'newUsersLast7d=0 directly supports the claim',
    };
  }

  // Acquisition strategy failed / causal from zero
  if (
    ACQUISITION_FAIL_RE.test(text) ||
    (/신규.{0,40}0/.test(text) && /의미|전략|실패/.test(text))
  ) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_CAUSALITY' },
      recommendedAction: 'NARROW',
      missingEvidence: ['acquisition_strategy_metrics', 'channel_attribution'],
      judgeReason: 'Zero new users ≠ acquisition strategy failure (causal leap)',
    };
  }

  // comments=0 direct
  if (
    /댓글.{0,30}(0|없|없으|zero|없음을)/i.test(text) &&
    !GLOBAL_ENGAGEMENT_RE.test(text) &&
    !/UX|원인|때문에/.test(text) &&
    a.commentsLast7d === 0
  ) {
    return {
      classification: {
        evidenceType: 'DIRECT_FACT',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
      },
      semanticLeap: { detected: false, type: 'NONE' },
      recommendedAction: 'NO_CHANGE',
      missingEvidence: [],
      judgeReason: 'commentsLast7d=0 directly supports no recent comment activity',
    };
  }

  // Global engagement from comments alone
  if (GLOBAL_ENGAGEMENT_RE.test(text) && a.commentsLast7d === 0) {
    missing.push('activeUsersLast7d', 'viewsLast7d', 'sessions');
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'PARTIALLY_SUPPORTED',
        evidenceRelation: 'PARTIALLY_SUPPORTS',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_GLOBAL_CONCLUSION' },
      recommendedAction: 'NARROW',
      missingEvidence: missing,
      judgeReason: 'comments=0 partially supports weak interaction; not platform-wide engagement',
    };
  }

  // Trend from postCount / postsLast7d without prior
  if (
    TREND_RE.test(text) &&
    /게시|posts?|생산/.test(text) &&
    typeof a.postCount === 'number' &&
    typeof a.postsLast7d === 'number'
  ) {
    missing.push('postsPriorPeriod');
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_TREND' },
      recommendedAction: 'REQUEST_MORE_EVIDENCE',
      missingEvidence: missing,
      judgeReason: 'Single-period postsLast7d/postCount cannot establish decline trend',
    };
  }

  // Tech stack → quality
  if (TECH_QUALITY_RE.test(text) || (TECH_STACK_RE.test(text) && /확장성|성능|품질|scalab|performance/i.test(text))) {
    missing.push('latency', 'error_rate', 'load_test');
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'TECH_STACK_TO_QUALITY' },
      recommendedAction: 'ADD_CAVEAT',
      missingEvidence: missing,
      judgeReason: 'Stack composition ≠ verified scalability/performance',
    };
  }

  // Fallback to v7 entailment heuristic
  const ev = evaluateEvidenceClaimEntailment({ claimText: text, evidence });
  let leapType: SemanticLeapType = 'NONE';
  if (ev.flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE')) leapType = 'UNKNOWN_AS_NEGATIVE_EVIDENCE';
  else if (ev.flags.includes('UNSUPPORTED_CAUSAL_CLAIM')) leapType = 'FACT_TO_CAUSALITY';
  else if (ev.flags.includes('UNSUPPORTED_TIME_TREND')) leapType = 'FACT_TO_TREND';
  else if (ev.unsupportedLeap) leapType = 'FACT_TO_GLOBAL_CONCLUSION';

  // Avoid false causal on pure measurement-gap “due to null”
  if (
    leapType === 'FACT_TO_CAUSALITY' &&
    MEASUREMENT_GAP_RE.test(text) &&
    /null|unavailable|측정/.test(text)
  ) {
    leapType = 'NONE';
  }

  const supportLevel: ClaimSupportLevel =
    ev.evidenceRelation === 'DIRECTLY_SUPPORTS'
      ? 'SUPPORTED'
      : ev.evidenceRelation === 'PARTIALLY_SUPPORTS'
        ? 'PARTIALLY_SUPPORTED'
        : 'NOT_SUPPORTED';

  const evidenceType: ClaimEvidenceType =
    ev.evidenceRelation === 'DIRECTLY_SUPPORTS'
      ? 'DIRECT_FACT'
      : ev.evidenceRelation === 'UNKNOWN'
        ? 'UNKNOWN'
        : leapType === 'FACT_TO_CAUSALITY'
          ? 'HYPOTHESIS'
          : 'INFERENCE';

  return {
    classification: {
      evidenceType,
      supportLevel,
      evidenceRelation: ev.evidenceRelation,
      overclaimRisk:
        leapType !== 'NONE' ? 'HIGH' : ev.semanticRisk === 'LOW' ? 'LOW' : 'MEDIUM',
    },
    semanticLeap: { detected: leapType !== 'NONE', type: leapType },
    recommendedAction:
      leapType === 'NONE'
        ? 'NO_CHANGE'
        : leapType === 'FACT_TO_TREND'
          ? 'REQUEST_MORE_EVIDENCE'
          : 'NARROW',
    missingEvidence: ev.missingEvidence.length ? ev.missingEvidence : missing,
    judgeReason: ev.explanation,
  };
}

export function compareToReference(
  judge: JudgeClassification,
  expected: ReferenceExpectedClassification,
  leapType: SemanticLeapType,
): JudgeVerdict {
  const supportOk = judge.supportLevel === expected.supportLevel;
  const relationOk = judge.evidenceRelation === expected.evidenceRelation;
  const leapOk =
    !expected.semanticLeapType ||
    expected.semanticLeapType === 'NONE' ||
    leapType === expected.semanticLeapType ||
    (expected.semanticLeapType !== 'NONE' && leapType !== 'NONE');

  const expectedRisky =
    expected.supportLevel === 'NOT_SUPPORTED' ||
    expected.supportLevel === 'PARTIALLY_SUPPORTED' ||
    (expected.semanticLeapType && expected.semanticLeapType !== 'NONE');
  const judgeFlagsRisky =
    judge.supportLevel === 'NOT_SUPPORTED' ||
    judge.overclaimRisk === 'HIGH' ||
    leapType !== 'NONE';

  if (expectedRisky && judgeFlagsRisky && (supportOk || relationOk || leapOk)) {
    return 'TRUE_POSITIVE';
  }
  if (!expectedRisky && !judgeFlagsRisky && supportOk) {
    return 'TRUE_NEGATIVE';
  }
  if (!expectedRisky && judgeFlagsRisky) {
    return 'FALSE_POSITIVE';
  }
  if (expectedRisky && !judgeFlagsRisky) {
    return 'FALSE_NEGATIVE';
  }
  return 'SEMANTICALLY_AMBIGUOUS';
}

export function calibrationAgreement(
  original: JudgeClassification,
  judge: JudgeClassification,
): 'AGREE' | 'DISAGREE' | 'PARTIAL' {
  if (
    original.supportLevel === judge.supportLevel &&
    original.evidenceRelation === judge.evidenceRelation
  ) {
    return 'AGREE';
  }
  if (
    original.supportLevel === judge.supportLevel ||
    original.evidenceRelation === judge.evidenceRelation
  ) {
    return 'PARTIAL';
  }
  return 'DISAGREE';
}

export type BuildJudgmentInput = {
  memberId: CommitteeAnalystId;
  claim: CalibratedClaim;
  semanticsRow?: EvidenceSemanticsRow | null;
  evidence: EvidencePack;
  /** LLM raw judgment (optional); overlay merges */
  llmJudgment?: Partial<SemanticJudgment> | null;
  /** Regression only */
  reference?: ReferenceExpectedClassification | null;
  /** Live = no classic TP/FP */
  liveMode?: boolean;
};

export function buildSemanticJudgment(input: BuildJudgmentInput): SemanticJudgment {
  const { memberId, claim, semanticsRow, evidence, llmJudgment, reference, liveMode } =
    input;
  const det = adjudicateClaimDeterministic(claim.claimText, evidence, claim.evidenceRefs);

  const originalSemanticClassification: JudgeClassification = {
    evidenceType: claim.evidenceType,
    supportLevel: claim.supportLevel,
    evidenceRelation: semanticsRow?.evidenceRelation ?? 'UNKNOWN',
    overclaimRisk: claim.riskOfOverclaiming,
  };

  // Prefer LLM classification when present; overlay overrides on clear deterministic leaps / majority
  let judgeClassification: JudgeClassification = {
    evidenceType: isClaimEvidenceType(llmJudgment?.judgeClassification?.evidenceType)
      ? llmJudgment!.judgeClassification!.evidenceType
      : det.classification.evidenceType,
    supportLevel: isClaimSupportLevel(llmJudgment?.judgeClassification?.supportLevel)
      ? llmJudgment!.judgeClassification!.supportLevel
      : det.classification.supportLevel,
    evidenceRelation: isEvidenceRelation(llmJudgment?.judgeClassification?.evidenceRelation)
      ? llmJudgment!.judgeClassification!.evidenceRelation
      : det.classification.evidenceRelation,
    overclaimRisk: isOverclaimRisk(llmJudgment?.judgeClassification?.overclaimRisk)
      ? llmJudgment!.judgeClassification!.overclaimRisk
      : det.classification.overclaimRisk,
  };

  let semanticLeap = {
    detected: det.semanticLeap.detected,
    type: det.semanticLeap.type,
  };
  if (llmJudgment?.semanticLeap && typeof llmJudgment.semanticLeap === 'object') {
    const sl = llmJudgment.semanticLeap;
    if (sl.detected && isSemanticLeapType(sl.type) && sl.type !== 'NONE') {
      semanticLeap = { detected: true, type: sl.type };
    }
  }
  // Overlay wins on clear deterministic leap
  if (det.semanticLeap.detected) {
    semanticLeap = det.semanticLeap;
    judgeClassification = det.classification;
  }

  let judgeReason =
    typeof llmJudgment?.judgeReason === 'string' && llmJudgment.judgeReason.trim()
      ? llmJudgment.judgeReason
      : det.judgeReason;
  if (textUsesMajorityAsJudgeGround(judgeReason)) {
    judgeReason = `${judgeReason} | OVERLAY: majority reasoning rejected`;
  }

  const recommendedAction: JudgeRecommendedAction =
    isJudgeRecommendedAction(llmJudgment?.recommendedAction) && !det.semanticLeap.detected
      ? llmJudgment!.recommendedAction!
      : det.recommendedAction;

  const missingEvidence =
    Array.isArray(llmJudgment?.missingEvidence) && llmJudgment!.missingEvidence!.length
      ? (llmJudgment!.missingEvidence as string[])
      : det.missingEvidence;

  let verdict: JudgeVerdict = 'SEMANTICALLY_AMBIGUOUS';
  if (reference) {
    verdict = compareToReference(judgeClassification, reference, semanticLeap.type);
  } else if (liveMode !== false) {
    // Live: never invent TP/FP/TN/FN
    verdict = 'SEMANTICALLY_AMBIGUOUS';
  }

  const confidence =
    typeof llmJudgment?.confidence === 'number'
      ? Math.min(1, Math.max(0, llmJudgment.confidence))
      : semanticLeap.detected
        ? 0.75
        : 0.7;

  return {
    memberId,
    claimId: claim.claimId,
    claimText: claim.claimText,
    evidenceRefs: claim.evidenceRefs,
    originalSemanticClassification,
    judgeClassification,
    verdict,
    calibrationAgreement: calibrationAgreement(
      originalSemanticClassification,
      judgeClassification,
    ),
    judgeReason,
    missingEvidence,
    semanticLeap,
    confidence,
    recommendedAction,
  };
}

export function normalizeSemanticJudgments(
  memberId: CommitteeAnalystId,
  raw: unknown,
  calibration: ClaimCalibration,
  semantics: EvidenceSemanticsMember | undefined,
  evidence: EvidencePack,
  liveMode = true,
): SemanticJudgment[] {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const arr = Array.isArray(o.judgments)
    ? o.judgments
    : Array.isArray(o.claims)
      ? o.claims
      : Array.isArray(raw)
        ? raw
        : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of arr) {
    if (item && typeof item === 'object') {
      const r = item as Record<string, unknown>;
      if (typeof r.claimId === 'string') byId.set(r.claimId, r);
    }
  }

  return calibration.claims.map((claim) => {
    const llm = byId.get(claim.claimId) ?? null;
    const semRow = semantics?.claims.find((c) => c.claimId === claim.claimId);
    const parsedLlm = llm
      ? ({
          judgeClassification: llm.judgeClassification as JudgeClassification | undefined,
          judgeReason: llm.judgeReason,
          missingEvidence: llm.missingEvidence,
          semanticLeap: llm.semanticLeap,
          confidence: llm.confidence,
          recommendedAction: llm.recommendedAction,
          verdict: isJudgeVerdict(llm.verdict) ? llm.verdict : undefined,
        } as Partial<SemanticJudgment>)
      : null;
    return buildSemanticJudgment({
      memberId,
      claim,
      semanticsRow: semRow,
      evidence,
      llmJudgment: parsedLlm,
      liveMode,
    });
  });
}

export type JudgeRevisionFlag =
  | 'CALIBRATION_JUDGE_MISMATCH'
  | 'JUDGE_REVISION_MISMATCH'
  | 'UNKNOWN_NEGATIVE_EVIDENCE'
  | 'CAUSAL_LEAP_RETAINED'
  | 'TREND_LEAP_RETAINED'
  | 'TECH_QUALITY_LEAP'
  | 'MAJORITY_DRIVEN_JUDGMENT';

export type JudgeRevisionCheck = {
  memberId: CommitteeAnalystId;
  claimId: string;
  flags: JudgeRevisionFlag[];
  reason: string;
};

export function runJudgeRevisionConsistency(
  judgments: SemanticJudgment[],
  revisions: RevisionRecord[],
): JudgeRevisionCheck[] {
  const results: JudgeRevisionCheck[] = [];
  for (const j of judgments) {
    const rev = revisions.find((r) => r.memberId === j.memberId);
    if (!rev) continue;
    const flags: JudgeRevisionFlag[] = [];
    const retain = `${rev.retainReason || ''}\n${rev.revisionReason || ''}\n${rev.confidenceChangeReason || ''}`;

    if (
      j.originalSemanticClassification.supportLevel === 'SUPPORTED' &&
      j.judgeClassification.supportLevel === 'NOT_SUPPORTED' &&
      rev.revisionStatus === 'UNCHANGED' &&
      retain.trim().length < 40
    ) {
      flags.push('CALIBRATION_JUDGE_MISMATCH');
    }

    if (
      j.semanticLeap.detected &&
      (j.judgeClassification.overclaimRisk === 'HIGH' ||
        j.recommendedAction === 'REWORD' ||
        j.recommendedAction === 'NARROW') &&
      rev.revisionStatus === 'UNCHANGED' &&
      !/(judge|leap|caveat|단서|좁히|인정|overclaim|semantic)/i.test(retain)
    ) {
      flags.push('JUDGE_REVISION_MISMATCH');
    }

    if (j.semanticLeap.type === 'UNKNOWN_AS_NEGATIVE_EVIDENCE') {
      flags.push('UNKNOWN_NEGATIVE_EVIDENCE');
    }
    if (
      j.semanticLeap.type === 'FACT_TO_CAUSALITY' &&
      rev.revisionStatus === 'UNCHANGED'
    ) {
      flags.push('CAUSAL_LEAP_RETAINED');
    }
    if (j.semanticLeap.type === 'FACT_TO_TREND' && rev.revisionStatus === 'UNCHANGED') {
      flags.push('TREND_LEAP_RETAINED');
    }
    if (
      j.semanticLeap.type === 'TECH_STACK_TO_QUALITY' &&
      rev.revisionStatus === 'UNCHANGED'
    ) {
      flags.push('TECH_QUALITY_LEAP');
    }
    if (textUsesMajorityAsJudgeGround(j.judgeReason)) {
      flags.push('MAJORITY_DRIVEN_JUDGMENT');
    }

    if (flags.length) {
      results.push({
        memberId: j.memberId,
        claimId: j.claimId,
        flags,
        reason: flags.join(', '),
      });
    }
  }
  return results;
}

export function summarizeSemanticJudgments(judgments: SemanticJudgment[]): {
  totalClaims: number;
  judgeReviewedClaims: number;
  truePositive: number | null;
  falsePositive: number | null;
  trueNegative: number | null;
  falseNegative: number | null;
  ambiguous: number;
  semanticLeapCount: number;
  unknownAsNegativeEvidenceCount: number;
  causalLeapCount: number;
  trendLeapCount: number;
  techQualityLeapCount: number;
  disagreeWithCalibration: number;
} {
  const hasClassic = judgments.some((j) => j.verdict !== 'SEMANTICALLY_AMBIGUOUS');
  const count = (v: JudgeVerdict) => judgments.filter((j) => j.verdict === v).length;
  return {
    totalClaims: judgments.length,
    judgeReviewedClaims: judgments.length,
    truePositive: hasClassic ? count('TRUE_POSITIVE') : null,
    falsePositive: hasClassic ? count('FALSE_POSITIVE') : null,
    trueNegative: hasClassic ? count('TRUE_NEGATIVE') : null,
    falseNegative: hasClassic ? count('FALSE_NEGATIVE') : null,
    ambiguous: count('SEMANTICALLY_AMBIGUOUS'),
    semanticLeapCount: judgments.filter((j) => j.semanticLeap.detected).length,
    unknownAsNegativeEvidenceCount: judgments.filter(
      (j) => j.semanticLeap.type === 'UNKNOWN_AS_NEGATIVE_EVIDENCE',
    ).length,
    causalLeapCount: judgments.filter((j) => j.semanticLeap.type === 'FACT_TO_CAUSALITY')
      .length,
    trendLeapCount: judgments.filter((j) => j.semanticLeap.type === 'FACT_TO_TREND').length,
    techQualityLeapCount: judgments.filter(
      (j) => j.semanticLeap.type === 'TECH_STACK_TO_QUALITY',
    ).length,
    disagreeWithCalibration: judgments.filter((j) => j.calibrationAgreement === 'DISAGREE')
      .length,
  };
}

export function formatSemanticJudgeFindings(
  judgments: SemanticJudgment[],
  mismatchCount: number,
): string[] {
  const s = summarizeSemanticJudgments(judgments);
  return [
    `Judge reviewed=${s.judgeReviewedClaims}/${s.totalClaims}`,
    `ambiguous=${s.ambiguous} leaps=${s.semanticLeapCount} disagreeCal=${s.disagreeWithCalibration}`,
    `unknownNeg=${s.unknownAsNegativeEvidenceCount} causal=${s.causalLeapCount} trend=${s.trendLeapCount} tech=${s.techQualityLeapCount}`,
    `judgeRevisionMismatch=${mismatchCount}`,
    ...(s.truePositive !== null
      ? [
          `regression TP=${s.truePositive} FP=${s.falsePositive} TN=${s.trueNegative} FN=${s.falseNegative}`,
        ]
      : ['live: TP/FP/TN/FN not assigned (no reference labels)']),
  ];
}

export function buildCriticJudgeOverlay(
  judgments: SemanticJudgment[],
  checks: JudgeRevisionCheck[],
): {
  semanticJudgeIntegrity: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  falsePositiveFlags: { ok: boolean; flags: string[] };
  falseNegativeFlags: { ok: boolean; flags: string[] };
  semanticLeapFlags: { ok: boolean; flags: string[] };
  unknownAsNegativeEvidenceFlags: { ok: boolean; flags: string[] };
  causalClaimFlags: { ok: boolean; flags: string[] };
  trendClaimFlags: { ok: boolean; flags: string[] };
  techQualityLeapFlags: { ok: boolean; flags: string[] };
  majorityDrivenJudgeFlags: { ok: boolean; flags: string[] };
  judgeRevisionMismatchFlags: { ok: boolean; flags: string[] };
} {
  const leaps = judgments
    .filter((j) => j.semanticLeap.detected)
    .map((j) => `${j.memberId}:${j.claimId}:${j.semanticLeap.type}`);
  const unknownNeg = judgments
    .filter((j) => j.semanticLeap.type === 'UNKNOWN_AS_NEGATIVE_EVIDENCE')
    .map((j) => `${j.memberId}:${j.claimId}`);
  const causal = judgments
    .filter((j) => j.semanticLeap.type === 'FACT_TO_CAUSALITY')
    .map((j) => `${j.memberId}:${j.claimId}`);
  const trend = judgments
    .filter((j) => j.semanticLeap.type === 'FACT_TO_TREND')
    .map((j) => `${j.memberId}:${j.claimId}`);
  const tech = judgments
    .filter((j) => j.semanticLeap.type === 'TECH_STACK_TO_QUALITY')
    .map((j) => `${j.memberId}:${j.claimId}`);
  const majority = judgments
    .filter((j) => textUsesMajorityAsJudgeGround(j.judgeReason))
    .map((j) => `${j.memberId}:${j.claimId}`);
  const mismatch = checks
    .filter((c) => c.flags.includes('JUDGE_REVISION_MISMATCH'))
    .map((c) => `${c.memberId}:${c.claimId}`);
  const fp = judgments
    .filter((j) => j.verdict === 'FALSE_POSITIVE')
    .map((j) => `${j.memberId}:${j.claimId}`);
  const fn = judgments
    .filter((j) => j.verdict === 'FALSE_NEGATIVE')
    .map((j) => `${j.memberId}:${j.claimId}`);

  const issues = [
    ...leaps.slice(0, 10),
    ...checks.map((c) => `${c.memberId}/${c.claimId}: ${c.reason}`),
  ];
  const status: 'PASS' | 'WARN' | 'FAIL' =
    mismatch.length + unknownNeg.length + causal.length > 0
      ? 'FAIL'
      : leaps.length > 0
        ? 'WARN'
        : 'PASS';

  return {
    semanticJudgeIntegrity: {
      status,
      issues,
      summary: `leaps=${leaps.length} mismatch=${mismatch.length} unknownNeg=${unknownNeg.length}`,
    },
    falsePositiveFlags: { ok: fp.length === 0, flags: fp },
    falseNegativeFlags: { ok: fn.length === 0, flags: fn },
    semanticLeapFlags: { ok: leaps.length === 0, flags: leaps },
    unknownAsNegativeEvidenceFlags: { ok: unknownNeg.length === 0, flags: unknownNeg },
    causalClaimFlags: { ok: causal.length === 0, flags: causal },
    trendClaimFlags: { ok: trend.length === 0, flags: trend },
    techQualityLeapFlags: { ok: tech.length === 0, flags: tech },
    majorityDrivenJudgeFlags: { ok: majority.length === 0, flags: majority },
    judgeRevisionMismatchFlags: { ok: mismatch.length === 0, flags: mismatch },
  };
}
