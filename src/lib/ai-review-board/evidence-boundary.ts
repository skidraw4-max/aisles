/**
 * v10 Evidence Interpretation Boundary helpers.
 * FACT → OBSERVATION → POSSIBLE_EXPLANATION → HYPOTHESIS → VERIFICATION
 * CROSS_SOURCE_DIVERGENCE is an observation state, not a root cause.
 */
import type {
  ClaimEvidenceType,
  ClaimSupportLevel,
  EvidencePack,
  EvidenceRelation,
  JudgeRecommendedAction,
  OverclaimRisk,
  ReasoningLevel,
  SemanticLeapType,
} from './types';

export type BoundaryAdjudication = {
  classification: {
    evidenceType: ClaimEvidenceType;
    supportLevel: ClaimSupportLevel;
    evidenceRelation: EvidenceRelation;
    overclaimRisk: OverclaimRisk;
  };
  semanticLeap: { detected: boolean; type: SemanticLeapType };
  recommendedAction: JudgeRecommendedAction;
  missingEvidence: string[];
  judgeReason: string;
  suggestedReasoningLevel: ReasoningLevel;
};

const DIVERGENCE_OBS_RE =
  /(다르|차이|불일치|괴리|discrepan|diverg|gap|다르다고|서로\s*다)/i;
const TRACKING_CAUSE_RE =
  /(tracking\s*(bug|failure|problem|system)|signup\s*tracking\s*fail|가입\s*추적\s*(실패|문제)|추적\s*(실패|버그|문제)|data\s*corruption|파이프라인\s*실패|tracking\s*system\s*failure)/i;
const DEVICE_RATIO_RE =
  /(mobile|모바일).{0,40}(desktop|데스크톱|PC)|device|디바이스/i;
const UX_PROBLEM_RE =
  /(UX|UI|사용성).{0,30}(문제|실패|열세|optimization|optimis|문제\s*있)|mobile\s+UX\s+problem/i;
const ENGAGEMENT_EVAL_RE =
  /(engagementRate|참여율).{0,60}(높|낮|좋|나쁘|meaningful|high|low|good|bad|우수|양호|심각)/i;
const BENCHMARK_RE = /(benchmark|업계|경쟁사|시장\s*평균|기준선|전주|전기|compared\s+to)/i;
const STACK_COMPETITIVE_RE =
  /(기술\s*스택|tech\s*stack|Next\.js|React|Prisma|Gemini|Supabase|modern\s+stack).{0,50}(경쟁\s*우위|competitive\s*advantage|기술적\s*경쟁력|경쟁력이\s*높)/i;
const COMPETITIVE_ONLY_RE = /(경쟁\s*우위|competitive\s*advantage|기술적\s*경쟁력)/i;
const MAJORITY_CONF_RE =
  /(전원\s*동의|모두\s*동의|all\s+reviewers\s+agree|majority).{0,40}(confidence|신뢰도|확신)/i;

function gaActive(pack: EvidencePack): number | null {
  return pack.ga4?.users?.activeUsers ?? pack.ga4?.metrics.activeUsers ?? null;
}
function gaNew(pack: EvidencePack): number | null {
  return pack.ga4?.users?.newUsers ?? null;
}
function gaViews(pack: EvidencePack): number | null {
  return pack.ga4?.views?.screenPageViews ?? pack.ga4?.metrics.screenPageViews ?? null;
}
function gaEngagementRate(pack: EvidencePack): number | null {
  return pack.ga4?.engagement?.engagementRate ?? null;
}
function hasGaDbActiveDivergence(pack: EvidencePack): boolean {
  const g = gaActive(pack);
  const d = pack.aggregates.activeUsersLast7d;
  return g != null && d != null && g !== d;
}
function hasGaDbNewDivergence(pack: EvidencePack): boolean {
  const g = gaNew(pack);
  const d = pack.aggregates.newUsersLast7d;
  return g != null && d != null && g !== d;
}
function hasGaDbViewsDivergence(pack: EvidencePack): boolean {
  const g = gaViews(pack);
  const d = pack.aggregates.viewsLast7d;
  return g != null && d != null && g !== d;
}
function hasAnyCrossSourceDivergence(pack: EvidencePack): boolean {
  return (
    hasGaDbActiveDivergence(pack) ||
    hasGaDbNewDivergence(pack) ||
    hasGaDbViewsDivergence(pack)
  );
}

/** Pure observation of GA≠DB (or similar) without causal wording. */
export function isCrossSourceDivergenceObservation(claimText: string): boolean {
  return DIVERGENCE_OBS_RE.test(claimText) && !TRACKING_CAUSE_RE.test(claimText);
}

export function isDivergenceAsCausalityClaim(claimText: string): boolean {
  return TRACKING_CAUSE_RE.test(claimText) || (
    DIVERGENCE_OBS_RE.test(claimText) &&
    /(때문에|원인|failure|bug|실패|문제\s*있|broken)/i.test(claimText) &&
    /(tracking|추적|가입|signup|파이프라인|pipeline)/i.test(claimText)
  );
}

export function isDeviceRatioToUxClaim(claimText: string): boolean {
  return DEVICE_RATIO_RE.test(claimText) && UX_PROBLEM_RE.test(claimText);
}

export function isEngagementWithoutBenchmarkClaim(claimText: string): boolean {
  return ENGAGEMENT_EVAL_RE.test(claimText) && !BENCHMARK_RE.test(claimText);
}

export function isTechStackToCompetitiveClaim(claimText: string): boolean {
  return STACK_COMPETITIVE_RE.test(claimText) || (
    COMPETITIVE_ONLY_RE.test(claimText) &&
    /(스택|Next|React|Prisma|Gemini|Supabase|modern)/i.test(claimText)
  );
}

export function isMajorityAsEvidenceClaim(claimText: string): boolean {
  return MAJORITY_CONF_RE.test(claimText) ||
    /(majority|전원\s*동의|모두\s*같은\s*의견).{0,30}(근거|evidence|때문에)/i.test(claimText);
}

export function suggestReasoningLevelForClaim(
  claimText: string,
  evidenceType: ClaimEvidenceType,
): ReasoningLevel {
  if (isDivergenceAsCausalityClaim(claimText) || isDeviceRatioToUxClaim(claimText) ||
      isTechStackToCompetitiveClaim(claimText)) {
    return 'HYPOTHESIS';
  }
  if (evidenceType === 'CROSS_SOURCE_DIVERGENCE' || isCrossSourceDivergenceObservation(claimText)) {
    return 'OBSERVATION';
  }
  if (evidenceType === 'DIRECT_FACT') return 'FACT';
  if (evidenceType === 'UNKNOWN') return 'VERIFICATION';
  if (evidenceType === 'HYPOTHESIS') return 'HYPOTHESIS';
  if (/검증|verify|확인\s*필요|needs\s*verification/i.test(claimText)) return 'VERIFICATION';
  if (/가능|일\s*수|may|might|could/i.test(claimText)) return 'POSSIBLE_EXPLANATION';
  return 'OBSERVATION';
}

/**
 * Judge validates optional Calibration reasoningLevel against claim wording.
 * Returns leap if level is too strong for the claim (e.g. FACT on causal divergence).
 */
export function validateReasoningLevel(
  claimText: string,
  reasoningLevel: ReasoningLevel | undefined,
  evidenceType: ClaimEvidenceType,
): { ok: boolean; leapType: SemanticLeapType; reason: string } {
  if (!reasoningLevel) {
    return { ok: true, leapType: 'NONE', reason: 'reasoningLevel omitted (optional)' };
  }
  if (
    reasoningLevel === 'FACT' &&
    (isDivergenceAsCausalityClaim(claimText) ||
      isDeviceRatioToUxClaim(claimText) ||
      isTechStackToCompetitiveClaim(claimText) ||
      evidenceType === 'CROSS_SOURCE_DIVERGENCE')
  ) {
    return {
      ok: false,
      leapType: 'HYPOTHESIS_PRESENTED_AS_FACT',
      reason: 'Causal/divergence/competitive claim cannot be reasoningLevel=FACT',
    };
  }
  if (
    reasoningLevel === 'OBSERVATION' &&
    isDivergenceAsCausalityClaim(claimText)
  ) {
    return {
      ok: false,
      leapType: 'DIVERGENCE_AS_CAUSALITY',
      reason: 'Causal tracking claim is HYPOTHESIS, not OBSERVATION',
    };
  }
  return { ok: true, leapType: 'NONE', reason: 'reasoningLevel consistent' };
}

/** Deterministic v10 boundary adjudication (checked before legacy rules). */
export function adjudicateEvidenceBoundary(
  claimText: string,
  evidence: EvidencePack,
  reasoningLevel?: ReasoningLevel,
): BoundaryAdjudication | null {
  const text = claimText.trim();

  const levelCheck = validateReasoningLevel(
    text,
    reasoningLevel,
    isCrossSourceDivergenceObservation(text) && hasAnyCrossSourceDivergence(evidence)
      ? 'CROSS_SOURCE_DIVERGENCE'
      : 'INFERENCE',
  );
  if (!levelCheck.ok) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: levelCheck.leapType },
      recommendedAction: 'REWORD',
      missingEvidence: ['definition_comparison', 'period_alignment', 'tracking_mapping'],
      judgeReason: levelCheck.reason,
      suggestedReasoningLevel: 'HYPOTHESIS',
    };
  }

  if (isMajorityAsEvidenceClaim(text)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'MAJORITY_AS_EVIDENCE' },
      recommendedAction: 'REWORD',
      missingEvidence: ['EvidencePack metrics'],
      judgeReason: 'Majority agreement is not EvidencePack support',
      suggestedReasoningLevel: 'HYPOTHESIS',
    };
  }

  if (isTechStackToCompetitiveClaim(text)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'TECH_STACK_TO_COMPETITIVE_ADVANTAGE' },
      recommendedAction: 'NARROW',
      missingEvidence: ['competitive_benchmark', 'outcome_metrics'],
      judgeReason: 'Modern stack presence ≠ competitive advantage',
      suggestedReasoningLevel: 'HYPOTHESIS',
    };
  }

  if (isDeviceRatioToUxClaim(text)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'DEVICE_RATIO_TO_UX' },
      recommendedAction: 'REWORD',
      missingEvidence: [
        'mobile_engagementRate',
        'mobile_session_duration',
        'mobile_conversion',
        'mobile_error',
      ],
      judgeReason: 'Device user counts alone do not entail mobile UX problems',
      suggestedReasoningLevel: 'HYPOTHESIS',
    };
  }

  if (isEngagementWithoutBenchmarkClaim(text) && gaEngagementRate(evidence) != null) {
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'PARTIALLY_SUPPORTED',
        evidenceRelation: 'PARTIALLY_SUPPORTS',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'ENGAGEMENT_WITHOUT_BENCHMARK' },
      recommendedAction: 'ADD_CAVEAT',
      missingEvidence: ['engagement_benchmark', 'prior_period_comparison'],
      judgeReason: 'engagementRate value alone does not justify high/low evaluation',
      suggestedReasoningLevel: 'OBSERVATION',
    };
  }

  if (isDivergenceAsCausalityClaim(text) && hasAnyCrossSourceDivergence(evidence)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'PARTIALLY_SUPPORTED',
        evidenceRelation: 'CONTEXT_ONLY',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'DIVERGENCE_AS_CAUSALITY' },
      recommendedAction: 'REWORD',
      missingEvidence: [
        'definition_comparison',
        'period_alignment',
        'event_criteria',
        'signup_event_mapping',
      ],
      judgeReason:
        'CROSS_SOURCE_DIVERGENCE is an observation; tracking/signup failure is HYPOTHESIS needing verification',
      suggestedReasoningLevel: 'HYPOTHESIS',
    };
  }

  if (isCrossSourceDivergenceObservation(text) && hasAnyCrossSourceDivergence(evidence)) {
    return {
      classification: {
        evidenceType: 'CROSS_SOURCE_DIVERGENCE',
        supportLevel: 'SUPPORTED',
        evidenceRelation: 'DIRECTLY_SUPPORTS',
        overclaimRisk: 'LOW',
      },
      semanticLeap: { detected: false, type: 'NONE' },
      recommendedAction: 'NO_CHANGE',
      missingEvidence: [],
      judgeReason:
        'GA vs DB (or similar) scale difference is CROSS_SOURCE_DIVERGENCE observation — not a proven root cause',
      suggestedReasoningLevel: 'OBSERVATION',
    };
  }

  // Device distribution observation without UX leap
  if (
    DEVICE_RATIO_RE.test(text) &&
    !UX_PROBLEM_RE.test(text) &&
    (evidence.ga4?.device?.mobile != null || evidence.ga4?.device?.desktop != null)
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
      judgeReason: 'Device distribution observation without UX causality',
      suggestedReasoningLevel: 'OBSERVATION',
    };
  }

  return null;
}
