import type { ScoreDimension } from './score-dimensions';

export const COMMITTEE_ANALYSTS = ['A', 'B', 'C', 'D', 'E'] as const;
export type CommitteeAnalystId = (typeof COMMITTEE_ANALYSTS)[number];

export type CommitteeMemberId = CommitteeAnalystId | 'F' | 'Chairman';

export type ReviewBoardPhase =
  | 'queued'
  | 'collecting_evidence'
  | 'independent'
  | 'debate'
  | 'claim_calibration'
  | 'evidence_semantics'
  | 'semantic_judge'
  | 'revision'
  | 'consistency_check'
  | 'critic'
  | 'chairman'
  | 'completed'
  | 'failed';

export type EvidenceKind = 'observation' | 'metric' | 'doc' | 'external_ref' | 'inference';

export type EvidenceItem = {
  kind: EvidenceKind;
  text: string;
  source?: string;
};

export type DimensionScore = {
  dimension: ScoreDimension;
  /** 0–100. evidence 없으면 null로 정규화될 수 있음 */
  score: number | null;
  evidence: EvidenceItem[];
};

export type ImprovementItem = {
  id: string;
  title: string;
  priority: number;
  expectedEffect: string;
  difficulty: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  rationale: string;
};

export type IndependentAnalysis = {
  memberId: CommitteeAnalystId;
  currentState: string;
  strengths: string[];
  problems: string[];
  trendGap: string;
  improvementNeed: string;
  improvements: ImprovementItem[];
  scores: DimensionScore[];
  judgmentBasis: string;
  confidence: number;
  /** 원본 보존 — 토론 후 변경해도 유지 */
  originalOpinion: string;
};

/** 토론 후 재검토 결과 — 강제 변경 금지, 정직한 선택 */
export const REVISION_STATUSES = ['UNCHANGED', 'PARTIAL', 'FULL'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export function isRevisionStatus(value: unknown): value is RevisionStatus {
  return value === 'UNCHANGED' || value === 'PARTIAL' || value === 'FULL';
}

export function revisionStatusImpliesChange(status: RevisionStatus): boolean {
  return status === 'PARTIAL' || status === 'FULL';
}

export type DebateTurn = {
  memberId: CommitteeAnalystId;
  agreement: string[];
  disagreement: string[];
  weakEvidence: string[];
  missed: string[];
  needsVerification: string[];
  /**
   * v3 only (revision folded into debate).
   * v4+: omit — use `RevisionRecord` in `run.revisions`.
   */
  revisionStatus?: RevisionStatus;
  revised?: boolean;
  revisionReason?: string | null;
  previousOpinion?: string | null;
  revisedOpinion?: string | null;
  finalOpinion?: string;
  confidence?: number;
};

export type RejectedArgument = {
  argument: string;
  reason: string;
};

/** Q1–Q12 checklist answers (stored in Raw JSON) */
export type RevisionAnswers = {
  q1_coreClaim: string;
  q2_strongestRebuttal: string;
  q3_rebuttalEvidenceKind: string;
  q4_evidenceGapsFound: string;
  q5_gapAffectsCoreClaim: string;
  q6_directlySupportedScope: string;
  q7_overclaimCheck: string;
  q8_whyRetainIfUnchanged: string;
  q9_claimsToChangeIfPartial: string;
  q10_groundsForFullRevision: string;
  q11_chosenStatus: RevisionStatus;
  q12_confidenceChange: string;
};

/** v4+ separate Revision Quality Pass */
export type RevisionRecord = {
  memberId: CommitteeAnalystId;
  revisionStatus: RevisionStatus;
  revised: boolean;
  originalOpinion: string;
  revisionReason: string | null;
  retainReason: string | null;
  changedClaims: string[];
  newEvidenceAccepted: string[];
  rejectedArguments: RejectedArgument[];
  confidenceBefore: number;
  confidenceAfter: number;
  confidenceChangeReason: string;
  finalOpinion: string;
  revisionAnswers: RevisionAnswers;
  /** v6+ calibration → revision mapping */
  calibrationImpactAssessment?: CalibrationImpactAssessment;
};

export const REVISION_ACTION_VALUES = [
  'REWORD',
  'NARROW',
  'DOWNGRADE_CONFIDENCE',
  'ADD_CAVEAT',
  'RETAIN_WITH_JUSTIFICATION',
  'NO_ACTION_NEEDED',
] as const;
export type RevisionAction = (typeof REVISION_ACTION_VALUES)[number];

export function isRevisionAction(v: unknown): v is RevisionAction {
  return (
    v === 'REWORD' ||
    v === 'NARROW' ||
    v === 'DOWNGRADE_CONFIDENCE' ||
    v === 'ADD_CAVEAT' ||
    v === 'RETAIN_WITH_JUSTIFICATION' ||
    v === 'NO_ACTION_NEEDED'
  );
}

export type AffectedClaimAssessment = {
  claimId: string;
  calibrationSupportLevel: ClaimSupportLevel;
  calibrationEvidenceImpact: EvidenceImpact;
  calibrationRiskOfOverclaiming: OverclaimRisk;
  revisionAction: RevisionAction;
  actionReason: string;
};

export type CalibrationImpactAssessment = {
  materiallyAffected: boolean;
  affectedClaims: AffectedClaimAssessment[];
};

export const CONSISTENCY_STATUSES = [
  'CONSISTENT',
  'PARTIALLY_CONSISTENT',
  'INCONSISTENT',
] as const;
export type ConsistencyStatus = (typeof CONSISTENCY_STATUSES)[number];

export function isConsistencyStatus(v: unknown): v is ConsistencyStatus {
  return (
    v === 'CONSISTENT' || v === 'PARTIALLY_CONSISTENT' || v === 'INCONSISTENT'
  );
}

export const CONSISTENCY_SEVERITIES = [
  'INFO',
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const;
export type ConsistencySeverity = (typeof CONSISTENCY_SEVERITIES)[number];

export function isConsistencySeverity(v: unknown): v is ConsistencySeverity {
  return (
    v === 'INFO' ||
    v === 'LOW' ||
    v === 'MEDIUM' ||
    v === 'HIGH' ||
    v === 'CRITICAL'
  );
}

/** v6 stored consistency row (mirrors checker output) */
export type CalibrationRevisionCheck = {
  memberId: CommitteeAnalystId;
  claimId: string;
  calibrationSupportLevel: ClaimSupportLevel;
  calibrationEvidenceImpact: EvidenceImpact;
  calibrationRiskOfOverclaiming: OverclaimRisk;
  revisionStatus: RevisionStatus;
  revisionAction: RevisionAction;
  consistency: ConsistencyStatus;
  severity: ConsistencySeverity;
  reason: string;
  flags?: string[];
};

export const CLAIM_EVIDENCE_TYPES = [
  'DIRECT_FACT',
  'INFERENCE',
  'HYPOTHESIS',
  'UNKNOWN',
] as const;
export type ClaimEvidenceType = (typeof CLAIM_EVIDENCE_TYPES)[number];

export function isClaimEvidenceType(v: unknown): v is ClaimEvidenceType {
  return (
    v === 'DIRECT_FACT' || v === 'INFERENCE' || v === 'HYPOTHESIS' || v === 'UNKNOWN'
  );
}

export const CLAIM_SUPPORT_LEVELS = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'NOT_SUPPORTED',
] as const;
export type ClaimSupportLevel = (typeof CLAIM_SUPPORT_LEVELS)[number];

export function isClaimSupportLevel(v: unknown): v is ClaimSupportLevel {
  return (
    v === 'SUPPORTED' || v === 'PARTIALLY_SUPPORTED' || v === 'NOT_SUPPORTED'
  );
}

export const EVIDENCE_IMPACTS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type EvidenceImpact = (typeof EVIDENCE_IMPACTS)[number];

export function isEvidenceImpact(v: unknown): v is EvidenceImpact {
  return (
    v === 'NONE' ||
    v === 'LOW' ||
    v === 'MEDIUM' ||
    v === 'HIGH' ||
    v === 'CRITICAL'
  );
}

export const OVERCLAIM_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type OverclaimRisk = (typeof OVERCLAIM_RISKS)[number];

export function isOverclaimRisk(v: unknown): v is OverclaimRisk {
  return v === 'LOW' || v === 'MEDIUM' || v === 'HIGH';
}

/** v5 Claim Calibration — one claim row */
export type CalibratedClaim = {
  claimId: string;
  claimText: string;
  evidenceRefs: string[];
  evidenceType: ClaimEvidenceType;
  supportLevel: ClaimSupportLevel;
  reason: string;
  missingEvidence: string[];
  evidenceImpact: EvidenceImpact;
  riskOfOverclaiming: OverclaimRisk;
};

/** v5 per-member claim calibration result */
export type ClaimCalibration = {
  memberId: CommitteeAnalystId;
  claims: CalibratedClaim[];
};

/** v7 Evidence relation */
export const EVIDENCE_RELATION_VALUES = [
  'DIRECTLY_SUPPORTS',
  'PARTIALLY_SUPPORTS',
  'CONTEXT_ONLY',
  'DOES_NOT_SUPPORT',
  'CONTRADICTS',
  'UNKNOWN',
] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATION_VALUES)[number];

export function isEvidenceRelation(v: unknown): v is EvidenceRelation {
  return (EVIDENCE_RELATION_VALUES as readonly string[]).includes(String(v));
}

export const ENTAILMENT_LEVEL_VALUES = [
  'DIRECT',
  'STRONG_INFERENCE',
  'WEAK_INFERENCE',
  'UNSUPPORTED',
  'UNKNOWN',
] as const;
export type EntailmentLevel = (typeof ENTAILMENT_LEVEL_VALUES)[number];

export function isEntailmentLevel(v: unknown): v is EntailmentLevel {
  return (ENTAILMENT_LEVEL_VALUES as readonly string[]).includes(String(v));
}

export const SEMANTIC_RISK_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type SemanticRisk = (typeof SEMANTIC_RISK_VALUES)[number];

export function isSemanticRisk(v: unknown): v is SemanticRisk {
  return (SEMANTIC_RISK_VALUES as readonly string[]).includes(String(v));
}

/** v7 per-claim evidence semantics row */
export type EvidenceSemanticsRow = {
  claimId: string;
  claimText: string;
  evidenceRelation: EvidenceRelation;
  entailmentLevel: EntailmentLevel;
  directEvidenceRefs: string[];
  supportingEvidenceRefs: string[];
  missingEvidence: string[];
  inferenceSteps: string[];
  unsupportedLeap: boolean;
  semanticRisk: SemanticRisk;
  explanation: string;
};

/** v7 per-member evidence semantics */
export type EvidenceSemanticsMember = {
  memberId: CommitteeAnalystId;
  claims: EvidenceSemanticsRow[];
};

/** v8 Semantic Judge */
export const JUDGE_VERDICTS = [
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'TRUE_NEGATIVE',
  'FALSE_NEGATIVE',
  'SEMANTICALLY_AMBIGUOUS',
] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

export function isJudgeVerdict(v: unknown): v is JudgeVerdict {
  return (JUDGE_VERDICTS as readonly string[]).includes(String(v));
}

export const SEMANTIC_LEAP_TYPES = [
  'UNKNOWN_AS_NEGATIVE_EVIDENCE',
  'FACT_TO_CAUSALITY',
  'FACT_TO_TREND',
  'FACT_TO_GLOBAL_CONCLUSION',
  'TECH_STACK_TO_QUALITY',
  'NONE',
] as const;
export type SemanticLeapType = (typeof SEMANTIC_LEAP_TYPES)[number];

export function isSemanticLeapType(v: unknown): v is SemanticLeapType {
  return (SEMANTIC_LEAP_TYPES as readonly string[]).includes(String(v));
}

export const JUDGE_RECOMMENDED_ACTIONS = [
  'NO_CHANGE',
  'REWORD',
  'NARROW',
  'DOWNGRADE_SUPPORT',
  'DOWNGRADE_CONFIDENCE',
  'ADD_CAVEAT',
  'REQUEST_MORE_EVIDENCE',
] as const;
export type JudgeRecommendedAction = (typeof JUDGE_RECOMMENDED_ACTIONS)[number];

export function isJudgeRecommendedAction(v: unknown): v is JudgeRecommendedAction {
  return (JUDGE_RECOMMENDED_ACTIONS as readonly string[]).includes(String(v));
}

export type SemanticJudgeClassification = {
  evidenceType: ClaimEvidenceType;
  supportLevel: ClaimSupportLevel;
  evidenceRelation: EvidenceRelation;
  overclaimRisk: OverclaimRisk;
};

export type SemanticJudgment = {
  memberId: CommitteeAnalystId;
  claimId: string;
  claimText: string;
  evidenceRefs: string[];
  originalSemanticClassification: SemanticJudgeClassification;
  judgeClassification: SemanticJudgeClassification;
  /** Live Gemini: typically SEMANTICALLY_AMBIGUOUS; TP/FP/TN/FN only with regression reference */
  verdict: JudgeVerdict;
  /** Operational: Judge vs Calibration/Semantics agreement (not classic FP/FN) */
  calibrationAgreement?: 'AGREE' | 'DISAGREE' | 'PARTIAL';
  judgeReason: string;
  missingEvidence: string[];
  semanticLeap: {
    detected: boolean;
    type: SemanticLeapType;
  };
  confidence: number;
  recommendedAction: JudgeRecommendedAction;
  /** v9+: deterministic overlay flags (never auto-rewrite LLM judgment) */
  overlayFlags?: string[];
};

export type SemanticJudgeSummary = {
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
  judgeRevisionMismatchCount: number;
  disagreeWithCalibration?: number;
  /** v9 live revision-influence (not classic TP/FP) */
  judgeTriggeredRevision?: number;
  judgeTriggeredReword?: number;
  judgeTriggeredNarrow?: number;
  judgeTriggeredConfidenceChange?: number;
  judgeIgnoredRisk?: number;
};

export type CriticCheck = {
  ok: boolean;
  flags: string[];
};

export type CriticReport = {
  factVsSpeculationOk: boolean;
  evidenceSufficient: boolean;
  scoresWithoutEvidence: string[];
  herdingDetected: boolean;
  dominantMemberInfluence: string | null;
  trendEvidenceOk: boolean;
  userBenefitLikely: boolean;
  existingFeatureRisk: boolean;
  overEngineering: boolean;
  notes: string[];
  confidence: number;
  /** v4+ optional integrity checks */
  revisionIntegrity?: CriticCheck;
  evidenceGrounding?: CriticCheck;
  overclaiming?: CriticCheck;
  herding?: CriticCheck;
  confidenceIntegrity?: CriticCheck;
  fabrication?: CriticCheck;
  statusConsistency?: CriticCheck;
  /** v5+ claim calibration checks */
  claimCalibrationIntegrity?: CriticCheck;
  evidenceMappingIntegrity?: CriticCheck;
  unsupportedClaimFlags?: CriticCheck;
  overclaimingFlags?: CriticCheck;
  unknownAsEvidenceFlags?: CriticCheck;
  causalClaimWithoutEvidenceFlags?: CriticCheck;
  confidenceCalibrationFlags?: CriticCheck;
  herdingFlags?: CriticCheck;
  /** v6+ calibration ↔ revision (deterministic checker overlay) */
  calibrationRevisionIntegrity?: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  calibrationRevisionMismatchFlags?: CriticCheck;
  overclaimRetainedFlags?: CriticCheck;
  unknownAsNegativeEvidenceFlags?: CriticCheck;
  unjustifiedConfidenceFlags?: CriticCheck;
  majorityDrivenRevisionFlags?: CriticCheck;
  /** v7+ evidence semantics */
  evidenceSemanticsIntegrity?: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  evidenceClaimSemanticMismatchFlags?: CriticCheck;
  absenceOfEvidenceAsAbsenceFlags?: CriticCheck;
  unsupportedCausalClaimFlags?: CriticCheck;
  unsupportedRelativeClaimFlags?: CriticCheck;
  unsupportedTimeTrendFlags?: CriticCheck;
  unsupportedLeapFlags?: CriticCheck;
  contextMistakenAsEvidenceFlags?: CriticCheck;
  peerOpinionAsEvidenceFlags?: CriticCheck;
  /** v8+ semantic judge */
  semanticJudgeIntegrity?: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  falsePositiveFlags?: CriticCheck;
  falseNegativeFlags?: CriticCheck;
  semanticLeapFlags?: CriticCheck;
  causalClaimFlags?: CriticCheck;
  trendClaimFlags?: CriticCheck;
  techQualityLeapFlags?: CriticCheck;
  majorityDrivenJudgeFlags?: CriticCheck;
  judgeRevisionMismatchFlags?: CriticCheck;
};

export type RevisionSummaryBlock = {
  unchanged: string[];
  partial: string[];
  full: string[];
  confidenceShifts: string[];
  claimSofteningFromEvidenceGap: string[];
  herdingRisks: string[];
};

export type FinalReport = {
  statusSummary: string;
  overallTrendScore: number | null;
  dimensionScores: DimensionScore[];
  topProblems: string[];
  improvements: ImprovementItem[];
  expectedUserEffect: string;
  expectedDifficulty: string;
  risk: string;
  improvementEvidence: string[];
  opinionDifferences: string[];
  confidence: number;
  needsFurtherVerification: string[];
  /** v4+ optional structured sections */
  confirmedFacts?: string[];
  unknownMissingData?: string[];
  hypotheses?: string[];
  disputedPoints?: string[];
  validatedImprovements?: string[];
  revisionSummary?: RevisionSummaryBlock;
  /** v5+ */
  supportedClaims?: string[];
  partiallySupportedClaims?: string[];
  unsupportedHypothesisClaims?: string[];
  /** v6+ */
  calibrationRevisionFindings?: string[];
  /** v7+ */
  evidenceSemanticsFindings?: string[];
  directlySupportedClaims?: string[];
  supportedInferences?: string[];
  weakLimitedInferences?: string[];
  /** v8+ */
  semanticJudgeFindings?: string[];
  semanticRisks?: string[];
  semanticJudgeSummary?: SemanticJudgeSummary;
};

export type EvidenceAggregates = {
  userCount: number | null;
  /**
   * @deprecated 의미 혼동 주의 — 실제로는 최근 7일 **신규 가입** 수.
   * 새 코드는 `newUsersLast7d`를 우선 사용.
   */
  usersLast7d: number | null;
  /** 최근 7일 신규 가입 수 (= User.createdAt >= now-7d). DAU/WAU 아님. */
  newUsersLast7d: number | null;
  /**
   * 최근 7일 활성 사용자 수.
   * TODO: 활동 정의(게시/댓글/좋아요 등) 미확정 — 임의 산출 금지. 현재는 null.
   */
  activeUsersLast7d: number | null;
  postCount: number | null;
  postsLast7d: number | null;
  /** 최근 7일 신규 댓글 수 (Comment.createdAt). 안전하게 산출 가능. */
  commentsLast7d: number | null;
  /**
   * 최근 7일 조회수.
   * TODO: Post.views는 누적만 있어 기간별 조회 불가 — 현재 null.
   */
  viewsLast7d: number | null;
  totalViews: number | null;
  commentCount: number | null;
  postsByCategory: Record<string, number>;
};

/** EvidencePack 지표 정의 (프롬프트·문서·UI 공통) — AI 오해 방지용 강제 문구 */
export const EVIDENCE_METRIC_DEFINITIONS = {
  userCount: '전체 회원 수 (User 테이블 row count).',
  usersLast7d:
    'DEPRECATED. newUsersLast7d 와 동일한 값(최근 7일 신규 가입). 활성 사용자/DAU/WAU/방문자가 아님. 절대 active users 로 해석하지 말 것.',
  newUsersLast7d:
    '최근 7일 신규 가입자 수 (User.createdAt >= now-7d). NOT active users, NOT DAU/WAU, NOT visitors.',
  activeUsersLast7d:
    '최근 7일 활성 사용자. 현재 신뢰 가능한 활동 정의 없음 → 반드시 null. 신규 가입(newUsersLast7d)으로 대체·추정 금지.',
  postCount: '전체 게시글 수 (Post count).',
  postsLast7d: '최근 7일 작성 게시글 수 (Post.createdAt >= now-7d).',
  commentsLast7d: '최근 7일 작성 댓글 수 (Comment.createdAt >= now-7d).',
  viewsLast7d:
    '최근 7일 조회수. Post.views 는 누적만 존재 → 현재 null. totalViews 로 추정 금지.',
  totalViews: '전체 기간 게시글 조회수 합 (Post.views sum). 최근 7일 조회수가 아님.',
  commentCount: '전체 댓글 수 (Comment count).',
  postsByCategory: '카테고리별 게시글 수.',
} as const;

/** 프롬프트 상단 고정 경고 (EvidencePack JSON 앞에 붙임) */
export const EVIDENCE_METRIC_PROMPT_GUARD = `METRIC INTERPRETATION RULES (must follow):
1. newUsersLast7d / usersLast7d = NEW SIGNUPS in last 7 days ONLY. Never call this "active users", DAU, WAU, or engagement.
2. activeUsersLast7d is null until an approved activity definition exists. Do not invent or substitute from newUsersLast7d.
3. viewsLast7d is null. Do not estimate it from totalViews.
4. commentsLast7d is last-7-day comment creations when present; commentCount is all-time.
5. If a metric is null, say "unknown / not measured" — do not treat null as zero engagement proof by itself.
6. Prefer citing newUsersLast7d by name; avoid relying on deprecated usersLast7d.`;


export type EvidencePack = {
  generatedAt: string;
  site: {
    name: string;
    corridors: string[];
    stackNotes: string[];
  };
  aggregates: EvidenceAggregates;
  /** 지표 의미 (AI 오해 방지) */
  metricDefinitions: typeof EVIDENCE_METRIC_DEFINITIONS;
  docsHints: string[];
  /** PII 미포함 보장용 메타 */
  piiExcluded: true;
  readOnly: true;
};

export type CallBudget = {
  maxCalls: number;
  usedCalls: number;
  estimatedCostUsd: number;
  warnings: string[];
};

export type ReviewBoardRun = {
  runId: string;
  status: ReviewBoardPhase;
  createdAt: string;
  updatedAt: string;
  evidence: EvidencePack | null;
  independent: IndependentAnalysis[];
  debate: DebateTurn[];
  /** v5+ Claim Calibration */
  claimCalibrations?: ClaimCalibration[];
  /** v7+ Evidence Semantics / Claim Entailment */
  evidenceSemantics?: EvidenceSemanticsMember[];
  /** v8+ Semantic Judge (before Revision) */
  semanticJudgments?: SemanticJudgment[];
  /** v4+ Revision Quality Pass results */
  revisions?: RevisionRecord[];
  /** v6+ deterministic consistency rows */
  calibrationRevisionChecks?: CalibrationRevisionCheck[];
  critic: CriticReport | null;
  final: FinalReport | null;
  budget: CallBudget;
  error?: string;
};

export type HistoryEvent = {
  at: string;
  type: string;
  actor: CommitteeMemberId | 'system';
  payload: unknown;
};

/** LLM에 넘기는 컨텍스트 — 독립 단계에서는 peerAnalyses 금지 */
export type LlmContext = {
  phase:
    | 'independent'
    | 'debate'
    | 'claim_calibration'
    | 'evidence_semantics'
    | 'semantic_judge'
    | 'revision'
    | 'consistency_check'
    | 'critic'
    | 'chairman';
  memberId?: CommitteeMemberId;
  evidence: EvidencePack;
  /** independent에서는 반드시 undefined/빈 배열 */
  peerAnalyses?: IndependentAnalysis[];
  debate?: DebateTurn[];
  critic?: CriticReport | null;
};
