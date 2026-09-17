import type {
  CommitteeAnalystId,
  CriticReport,
  DebateTurn,
  EvidencePack,
  FinalReport,
  IndependentAnalysis,
  LlmContext,
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
  critic(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
  ): Promise<CriticReport>;
  chairman(
    evidence: EvidencePack,
    independent: IndependentAnalysis[],
    debate: DebateTurn[],
    critic: CriticReport,
  ): Promise<FinalReport>;
};
