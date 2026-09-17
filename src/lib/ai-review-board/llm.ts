import type {
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
  /** v4: separate Revision Quality Pass */
  revisionPass(
    memberId: CommitteeAnalystId,
    evidence: EvidencePack,
    own: IndependentAnalysis,
    ownDebate: DebateTurn,
    peers: IndependentAnalysis[],
  ): Promise<RevisionRecord>;
  critic(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    revisions?: RevisionRecord[],
  ): Promise<CriticReport>;
  chairman(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    critic: CriticReport,
    revisions?: RevisionRecord[],
  ): Promise<FinalReport>;
};
