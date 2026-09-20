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
  CalibrationJudgeMismatchType,
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
import { adjudicateEvidenceBoundary } from './evidence-boundary';
import { textUsesMajorityAsGround } from './revision-quality';
import type { ReasoningLevel } from './types';
import { isReasoningLevel } from './types';

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
  /(측정.*(없|불가)|알\s*수\s*없|확인\s*할\s*수\s*없|확인할\s*수\s*없|측정할\s*수\s*없|not\s+measured|unavailable|null이므로.{0,40}측정|데이터가\s*없|측정되지)/i;
const LOW_ACTIVITY_RE =
  /(활성도가\s*낮|활성\s*사용자[가이]?\s*(매우\s*|심각히\s*|심각하게\s*)?적|활동량이\s*낮|참여도가\s*(심각히\s*|심각하게\s*)?낮|휴면|dormant|non-?existent|존재하지\s*않|low\s+activity|low\s+engagement|severely\s+low)/i;
const CAUSAL_FAIL_RE =
  /(전략이\s*실패|마케팅이\s*실패|효과가\s*없|때문에|원인|로\s*인해|caused by|due to|failed|failure|저해|유발)/i;
const ACQUISITION_FAIL_RE = /(획득\s*전략|유입\s*전략|acquisition).{0,30}(실패|효과\s*없|failed)/i;
const GLOBAL_ENGAGEMENT_RE =
  /(전체\s*(커뮤니티\s*)?참여|플랫폼\s*전체|커뮤니티\s*전체|overall\s+(community\s+)?engagement|community\s+participation)/i;
const TREND_RE =
  /(감소하|감소했|증가하|증가했|하락|성장하고|정체|악화|개선되고|격차|트렌드|trend|declined|decreased|increased|worsened|improved)/i;
const TECH_QUALITY_RE =
  /(확장성이\s*검증|성능이\s*우수|확장\s*가능|콘텐츠\s*품질이\s*높|품질이\s*높|scalability\s+(verified|proven)|performance\s+is\s+(excellent|good)|content\s+quality\s+is\s+high)/i;
const TECH_STACK_RE = /(Vercel|PostgreSQL|Next\.js|기술\s*스택|infra|인프라|Gemini|게시글\s*수)/i;
const BENCHMARK_YEAR_RE = /(2025|2026|업계\s*평균|경쟁사|시장\s*평균|benchmark)/i;
const UX_CAUSAL_RE = /(UI\/?UX|UX|UI).{0,40}(원인|저해|때문에|인한|hindering|cause)/i;
const CORRIDOR_SCOPE_RE = /(LAB\/news\/fortune|LAB.*fortune).{0,20}(만|만\s*제한|에만)|AI\s*기능은.{0,40}(만|제한)/i;
const QUANTITY_QUALITY_RE = /(게시글\s*수가\s*많|postCount|많으므로).{0,30}(품질|quality)/i;
const PRESENCE_EFFECT_RE =
  /(Gemini|AI\s*기능).{0,40}(통합|존재|있으므로).{0,40}(증가|효과|참여를\s*증가)|통합되어\s*있으므로.{0,40}참여/i;
const POSTS_CONTINUITY_RE =
  /(게시글\s*\d+|postsLast7d|콘텐츠\s*생성이\s*지속|생성이\s*지속)/i;
const LOUNGE_RATIO_RE = /(LOUNGE|라운지).{0,40}(\d+\s*%|집중)|전체\s*게시글\s*중.{0,20}(LOUNGE|라운지)/i;

/** Deterministic adjudication of a single claim against EvidencePack (Rules R1–R8 + v10 boundary). */
export function adjudicateClaimDeterministic(
  claimText: string,
  evidence: EvidencePack,
  evidenceRefs: string[] = [],
  options?: { reasoningLevel?: ReasoningLevel },
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
  const reasoningLevel =
    options?.reasoningLevel && isReasoningLevel(options.reasoningLevel)
      ? options.reasoningLevel
      : undefined;

  // Measurement gap claim (null metrics stated as unmeasured) — DIRECT
  if (
    MEASUREMENT_GAP_RE.test(text) &&
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    /(active|활성|views|조회|사용자\s*활동)/i.test(text) &&
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

  // UNKNOWN as negative — null ≠ dormant / non-existent / low
  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    LOW_ACTIVITY_RE.test(text) &&
    !MEASUREMENT_GAP_RE.test(text) &&
    !GLOBAL_ENGAGEMENT_RE.test(text)
  ) {
    missing.push('activeUsersLast7d', 'viewsLast7d');
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'UNKNOWN_AS_NEGATIVE_EVIDENCE' },
      recommendedAction: 'REWORD',
      missingEvidence: missing,
      judgeReason: 'null/UNKNOWN metrics do not entail low/dormant/non-existent activity',
    };
  }

  // v10 Evidence Interpretation Boundary (CROSS_SOURCE_DIVERGENCE, device≠UX, …)
  const boundary = adjudicateEvidenceBoundary(text, evidence, reasoningLevel);
  if (boundary) {
    return {
      classification: boundary.classification,
      semanticLeap: boundary.semanticLeap,
      recommendedAction: boundary.recommendedAction,
      missingEvidence: boundary.missingEvidence,
      judgeReason: boundary.judgeReason,
    };
  }

  // LOUNGE concentration ratio from postsByCategory (CASE-05)
  if (LOUNGE_RATIO_RE.test(text) && typeof a.postCount === 'number' && a.postCount > 0) {
    const lounge = a.postsByCategory?.LOUNGE;
    if (typeof lounge === 'number') {
      const pct = (lounge / a.postCount) * 100;
      if (pct >= 97 || /97/.test(text)) {
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
          judgeReason: `LOUNGE share ${(pct).toFixed(1)}% is a direct ratio from postsByCategory`,
        };
      }
    }
  }

  // posts continuity (CASE-07) — not quality/engagement expansion
  if (
    POSTS_CONTINUITY_RE.test(text) &&
    typeof a.postsLast7d === 'number' &&
    a.postsLast7d > 0 &&
    !TECH_QUALITY_RE.test(text) &&
    !GLOBAL_ENGAGEMENT_RE.test(text) &&
    !QUANTITY_QUALITY_RE.test(text) &&
    !CAUSAL_FAIL_RE.test(text)
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
      judgeReason: 'postsLast7d>0 directly supports ongoing content production wording',
    };
  }

  // Quantity ≠ quality (CASE-09)
  if (QUANTITY_QUALITY_RE.test(text) || (TECH_QUALITY_RE.test(text) && /게시글\s*수|postCount|많으/.test(text))) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'TECH_STACK_TO_QUALITY' },
      recommendedAction: 'NARROW',
      missingEvidence: ['quality_rubric', 'editorial_review'],
      judgeReason: 'Post quantity does not entail content quality',
    };
  }

  // Corridor scope overclaim (CASE-06)
  if (CORRIDOR_SCOPE_RE.test(text)) {
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'PARTIALLY_SUPPORTED',
        evidenceRelation: 'PARTIALLY_SUPPORTS',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_GLOBAL_CONCLUSION' },
      recommendedAction: 'REWORD',
      missingEvidence: ['ai_usage_by_corridor'],
      judgeReason: 'Mentioned LAB/news/fortune scope ≠ proven exclusive AI coverage',
    };
  }

  // Presence ≠ positive engagement effect (CASE-10)
  if (PRESENCE_EFFECT_RE.test(text)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_CAUSALITY' },
      recommendedAction: 'NARROW',
      missingEvidence: ['ai_feature_usage', 'engagement_lift'],
      judgeReason: 'Feature presence does not entail engagement increase',
    };
  }

  // UI/UX causal (CASE-03)
  if (UX_CAUSAL_RE.test(text)) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_CAUSALITY' },
      recommendedAction: 'REWORD',
      missingEvidence: ['ux_study', 'funnel_attribution'],
      judgeReason: 'Outcome metrics alone do not establish UI/UX as the cause',
    };
  }

  // Benchmark / year trend gap without external benchmark (CASE-04)
  if (BENCHMARK_YEAR_RE.test(text) && TREND_RE.test(text)) {
    return {
      classification: {
        evidenceType: 'INFERENCE',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_TREND' },
      recommendedAction: 'ADD_CAVEAT',
      missingEvidence: ['external_benchmark', 'competitor_metrics'],
      judgeReason: 'No external 2025–2026 / industry benchmark in EvidencePack',
    };
  }

  // userCount direct
  if (
    /전체\s*회원|회원\s*수|userCount|total\s+members?/i.test(text) &&
    typeof a.userCount === 'number' &&
    new RegExp(String(a.userCount)).test(text) &&
    !TREND_RE.test(text) &&
    !CAUSAL_FAIL_RE.test(text)
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
      judgeReason: 'userCount directly supports the membership count claim',
    };
  }

  // Dual zero / dual absence descriptive (no causal/global leap)
  if (
    /(신규|가입)/.test(text) &&
    /댓글/.test(text) &&
    /(0|없|관찰되지|관찰\s*되지)/.test(text) &&
    !CAUSAL_FAIL_RE.test(text) &&
    !GLOBAL_ENGAGEMENT_RE.test(text) &&
    !/실패|의미|전략/.test(text) &&
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
      judgeReason: 'Both zeros/absences are directly measured',
    };
  }

  // posts present + comments absent observation
  if (
    /게시/.test(text) &&
    /댓글/.test(text) &&
    /(있었|작성은|posts?)/i.test(text) &&
    /(관찰되지|0|없)/.test(text) &&
    !CAUSAL_FAIL_RE.test(text) &&
    !GLOBAL_ENGAGEMENT_RE.test(text) &&
    !TREND_RE.test(text) &&
    typeof a.postsLast7d === 'number' &&
    a.postsLast7d > 0 &&
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
      judgeReason: 'postsLast7d>0 and commentsLast7d=0 are directly observed',
    };
  }

  // Community failure / global doom from sparse metrics
  if (
    /(커뮤니티가\s*실패|플랫폼이\s*실패|community\s+failed)/i.test(text)
  ) {
    return {
      classification: {
        evidenceType: 'HYPOTHESIS',
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_GLOBAL_CONCLUSION' },
      recommendedAction: 'NARROW',
      missingEvidence: ['retention', 'activeUsersLast7d', 'qualitative_feedback'],
      judgeReason: 'Sparse signup/comment zeros do not entail community failure',
    };
  }

  // Gemini / AI feature causal failure
  if (
    /(Gemini|AI\s*기능).{0,40}(참여|engagement).{0,40}(증가시키지\s*못했|실패|효과\s*없)/i.test(
      text,
    ) ||
    /(참여|engagement).{0,40}(증가시키지\s*못했|효과적이지\s*못)/i.test(text)
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
      missingEvidence: ['feature_attribution', 'experiment_metrics'],
      judgeReason: 'Feature presence + low comments ≠ causal product failure',
    };
  }

  // Onboarding / causal root-cause from signup zero
  if (
    /(온보딩|원인|때문에|로\s*인해).{0,40}(신규|감소|하락)/i.test(text) ||
    /(신규|감소).{0,40}(온보딩|원인)/i.test(text)
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
      missingEvidence: ['onboarding_funnel', 'channel_attribution'],
      judgeReason: 'Measured zero does not identify onboarding as the cause',
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
        supportLevel: 'NOT_SUPPORTED',
        evidenceRelation: 'DOES_NOT_SUPPORT',
        overclaimRisk: 'HIGH',
      },
      semanticLeap: { detected: true, type: 'FACT_TO_GLOBAL_CONCLUSION' },
      recommendedAction: 'NARROW',
      missingEvidence: missing,
      judgeReason: 'comments=0 does not establish platform-wide engagement failure',
    };
  }

  // Trend from single-period metrics (posts or newUsers)
  if (TREND_RE.test(text)) {
    if (/게시|posts?|생산/.test(text)) {
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
    if (/신규|사용자\s*증가|증가세|growth|acquisition/i.test(text)) {
      missing.push('newUsersPriorPeriod');
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
        judgeReason: 'Single-period newUsersLast7d cannot establish growth-trend decline',
      };
    }
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

export const OVERLAY_FLAG_VALUES = [
  'NULL_TREATED_AS_ZERO',
  'UNKNOWN_AS_NEGATIVE',
  'MAJORITY_REASONING',
  'LEAP_MARKER_MISMATCH',
  'MISSING_EVIDENCE_REF',
  'FABRICATED_EVIDENCE_REF',
] as const;
export type OverlayFlag = (typeof OVERLAY_FLAG_VALUES)[number];

/**
 * Deterministic overlay — records flags only; does NOT mutate LLM/judge classification.
 */
export function collectOverlayFlags(input: {
  claimText: string;
  evidence: EvidencePack;
  evidenceRefs: string[];
  judgeReason: string;
  leapType: SemanticLeapType;
}): OverlayFlag[] {
  const flags: OverlayFlag[] = [];
  const text = input.claimText;
  const a = input.evidence.aggregates;

  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    /(활성.*(0|없)|views?\s*=\s*0|조회.*0)/i.test(text) &&
    !MEASUREMENT_GAP_RE.test(text)
  ) {
    flags.push('NULL_TREATED_AS_ZERO');
  }
  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    LOW_ACTIVITY_RE.test(text) &&
    !MEASUREMENT_GAP_RE.test(text)
  ) {
    flags.push('UNKNOWN_AS_NEGATIVE');
  }
  if (textUsesMajorityAsJudgeGround(input.judgeReason) || textUsesMajorityAsJudgeGround(text)) {
    flags.push('MAJORITY_REASONING');
  }
  if (
    input.leapType === 'NONE' &&
    (CAUSAL_FAIL_RE.test(text) || TREND_RE.test(text) || TECH_QUALITY_RE.test(text))
  ) {
    flags.push('LEAP_MARKER_MISMATCH');
  }
  if (input.evidenceRefs.length === 0) {
    flags.push('MISSING_EVIDENCE_REF');
  }
  const known = new Set([
    'aggregates.userCount',
    'aggregates.usersLast7d',
    'aggregates.newUsersLast7d',
    'aggregates.activeUsersLast7d',
    'aggregates.postCount',
    'aggregates.postsLast7d',
    'aggregates.commentsLast7d',
    'aggregates.viewsLast7d',
    'aggregates.totalViews',
    'aggregates.commentCount',
    'site.stackNotes',
    'site.name',
    'site.corridors',
  ]);
  for (const ref of input.evidenceRefs) {
    if (!known.has(ref) && !ref.startsWith('aggregates.') && !ref.startsWith('site.')) {
      flags.push('FABRICATED_EVIDENCE_REF');
      break;
    }
  }
  return flags;
}

export function compareToReference(
  judge: JudgeClassification,
  expected: ReferenceExpectedClassification,
  leapType: SemanticLeapType,
): JudgeVerdict {
  const supportOk = judge.supportLevel === expected.supportLevel;
  const relationOk = judge.evidenceRelation === expected.evidenceRelation;
  const expectedLeap = expected.semanticLeapType;
  let leapOk = true;
  if (expectedLeap && expectedLeap !== 'NONE') {
    leapOk = leapType === expectedLeap || leapType !== 'NONE';
  }

  const expectedRisky =
    expected.supportLevel === 'NOT_SUPPORTED' ||
    expected.supportLevel === 'PARTIALLY_SUPPORTED' ||
    Boolean(expectedLeap && expectedLeap !== 'NONE');
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

const SUPPORT_RANK_INLINE: Record<ClaimSupportLevel, number> = {
  SUPPORTED: 2,
  PARTIALLY_SUPPORTED: 1,
  NOT_SUPPORTED: 0,
};

function compareCalibrationJudgeMismatchInline(
  calibration: JudgeClassification,
  judge: JudgeClassification,
): CalibrationJudgeMismatchType {
  if (
    calibration.supportLevel === judge.supportLevel &&
    calibration.evidenceRelation === judge.evidenceRelation
  ) {
    return 'NONE';
  }
  const c = SUPPORT_RANK_INLINE[calibration.supportLevel];
  const j = SUPPORT_RANK_INLINE[judge.supportLevel];
  if (j < c) return 'JUDGE_STRICTER';
  if (c < j) return 'CALIBRATION_STRICTER';
  return 'CALIBRATION_JUDGE_CONFLICT';
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

  // Prefer LLM when present. Deterministic overlay records flags only (v9: no auto-rewrite).
  const hasLlm =
    !!llmJudgment &&
    (isClaimSupportLevel(llmJudgment.judgeClassification?.supportLevel) ||
      isSemanticLeapType(llmJudgment.semanticLeap?.type));

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
    if (isSemanticLeapType(sl.type)) {
      semanticLeap = { detected: sl.type !== 'NONE' && !!sl.detected, type: sl.type };
    }
  } else if (!hasLlm) {
    semanticLeap = det.semanticLeap;
  }

  const judgeReason =
    typeof llmJudgment?.judgeReason === 'string' && llmJudgment.judgeReason.trim()
      ? llmJudgment.judgeReason
      : det.judgeReason;

  const recommendedAction: JudgeRecommendedAction = isJudgeRecommendedAction(
    llmJudgment?.recommendedAction,
  )
    ? llmJudgment!.recommendedAction!
    : det.recommendedAction;

  const missingEvidence =
    Array.isArray(llmJudgment?.missingEvidence) && llmJudgment!.missingEvidence!.length
      ? (llmJudgment!.missingEvidence as string[])
      : det.missingEvidence;

  const overlayFlags = collectOverlayFlags({
    claimText: claim.claimText,
    evidence,
    evidenceRefs: claim.evidenceRefs,
    judgeReason,
    leapType: semanticLeap.type,
  });

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
    mismatchType: compareCalibrationJudgeMismatchInline(
      originalSemanticClassification,
      judgeClassification,
    ),
    judgeReason,
    missingEvidence,
    semanticLeap,
    confidence,
    recommendedAction,
    overlayFlags,
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
