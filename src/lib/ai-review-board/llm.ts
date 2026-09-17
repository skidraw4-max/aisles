import type {
  ClaimCalibration,
  CommitteeAnalystId,
  CriticReport,
  DebateTurn,
  EvidencePack,
  EvidenceSemanticsMember,
  FinalReport,
  IndependentAnalysis,
  LlmContext,
  RevisionRecord,
  SemanticJudgment,
} from './types';

export type ReviewBoardLlm = {
  independentAnalysis(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    ctx: LlmContext,
  ): Promise<IndependentAnalysis>;
  debateTurn(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    peers: IndependentAnalysis[],
    own: IndependentAnalysis,
  ): Promise<DebateTurn>;
  claimCalibrate(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
  ): Promise<ClaimCalibration>;
  evidenceSemanticsPass(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    calibration: ClaimCalibration,
  ): Promise<EvidenceSemanticsMember>;
  /** v8: Semantic Judge before Revision */
  semanticJudgePass(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
    calibration: ClaimCalibration,
    evidenceSemantics: EvidenceSemanticsMember,
  ): Promise<SemanticJudgment[]>;
  revisionPass(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
    peers: IndependentAnalysis[],
    calibration?: ClaimCalibration,
    evidenceSemantics?: EvidenceSemanticsMember,
    semanticJudgments?: SemanticJudgment[],
  ): Promise<RevisionRecord>;
  critic(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    revisions?: RevisionRecord[],
    claimCalibrations?: ClaimCalibration[],
    evidenceSemantics?: EvidenceSemanticsMember[],
    semanticJudgments?: SemanticJudgment[],
  ): Promise<CriticReport>;
  chairman(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    critic: CriticReport,
    revisions?: RevisionRecord[],
    claimCalibrations?: ClaimCalibration[],
    evidenceSemantics?: EvidenceSemanticsMember[],
    semanticJudgments?: SemanticJudgment[],
  ): Promise<FinalReport>;
};
