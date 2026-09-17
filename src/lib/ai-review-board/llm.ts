import type {
  ClaimCalibration,
  CommitteeAnalystId,
  CriticReport,
  DebateTurn,
  EvidencePack,
  FinalReport,
  IndependentAnalysis,
  LlmContext,
  RevisionRecord,
} from './types';

export type ReviewBoardLlm = {
  independentAnalysis(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    ctx: LlmContext,
  ): Promise<IndependentAnalysis>;
  /** v4: rebuttal only — no revisionStatus decision */
  debateTurn(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    peers: IndependentAnalysis[],
    own: IndependentAnalysis,
  ): Promise<DebateTurn>;
  /** v5: Claim Calibration (once; EvidencePack is final ground for supportLevel) */
  claimCalibrate(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
  ): Promise<ClaimCalibration>;
  /** v4/v5: Revision Quality Pass — receives calibration when available */
  revisionPass(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
    peers: IndependentAnalysis[],
    calibration?: ClaimCalibration,
  ): Promise<RevisionRecord>;
  critic(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    revisions?: RevisionRecord[],
    claimCalibrations?: ClaimCalibration[],
  ): Promise<CriticReport>;
  chairman(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    critic: CriticReport,
    revisions?: RevisionRecord[],
    claimCalibrations?: ClaimCalibration[],
  ): Promise<FinalReport>;
};
