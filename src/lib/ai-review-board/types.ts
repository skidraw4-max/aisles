import type { ScoreDimension } from './score-dimensions';

export const COMMITTEE_ANALYSTS = ['A', 'B', 'C', 'D', 'E'] as const;
export type CommitteeAnalystId = (typeof COMMITTEE_ANALYSTS)[number];

export type CommitteeMemberId = CommitteeAnalystId | 'F' | 'Chairman';

export type ReviewBoardPhase =
  | 'queued'
  | 'collecting_evidence'
  | 'independent'
  | 'debate'
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

export type DebateTurn = {
  memberId: CommitteeAnalystId;
  agreement: string[];
  disagreement: string[];
  weakEvidence: string[];
  missed: string[];
  needsVerification: string[];
  revised: boolean;
  revisionReason: string | null;
  /** 변경 전 요약 (revised 시 필수) */
  previousOpinion: string | null;
  revisedOpinion: string | null;
  finalOpinion: string;
  confidence: number;
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

/** EvidencePack 지표 정의 (프롬프트·문서·UI 공통) */
export const EVIDENCE_METRIC_DEFINITIONS = {
  userCount: '전체 회원 수 (User rows)',
  usersLast7d:
    'DEPRECATED alias of newUsersLast7d — NOT active users / DAU / WAU',
  newUsersLast7d: '최근 7일 신규 가입자 수 (User.createdAt)',
  activeUsersLast7d:
    'TODO — not computed until activity definition is approved',
  postCount: '전체 게시글 수',
  postsLast7d: '최근 7일 작성 게시글 수 (Post.createdAt)',
  commentsLast7d: '최근 7일 작성 댓글 수 (Comment.createdAt)',
  viewsLast7d: 'TODO — not available (Post.views is cumulative only)',
  totalViews: '전체 게시글 조회수 합 (Post.views sum)',
  commentCount: '전체 댓글 수',
  postsByCategory: '카테고리별 게시글 수',
} as const;

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
  phase: 'independent' | 'debate' | 'critic' | 'chairman';
  memberId: CommitteeMemberId;
  evidence: EvidencePack;
  /** independent에서는 반드시 undefined/빈 배열 */
  peerAnalyses?: IndependentAnalysis[];
  debate?: DebateTurn[];
  critic?: CriticReport | null;
};
