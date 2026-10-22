import type { IndependentAnalysis, LlmContext } from './types';

export class IndependenceViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndependenceViolationError';
  }
}

/**
 * 독립 분석 단계에서 peer 분석이 컨텍스트에 들어가면 즉시 실패.
 * 오케스트레이터·LLM 어댑터 진입 전 가드.
 */
export function assertIndependentContext(ctx: LlmContext): void {
  if (ctx.phase !== 'independent') return;
  const peers = ctx.peerAnalyses;
  if (peers && peers.length > 0) {
    throw new IndependenceViolationError(
      `Independent phase must not include peer analyses (got ${peers.length})`,
    );
  }
  if (ctx.debate && ctx.debate.length > 0) {
    throw new IndependenceViolationError('Independent phase must not include debate turns');
  }
  if (ctx.critic) {
    throw new IndependenceViolationError('Independent phase must not include critic report');
  }
}

/** 토론 단계는 독립 분석이 전원 준비된 뒤에만 */
export function assertDebateReady(
  independent: IndependentAnalysis[],
  expectedMemberIds: readonly string[],
): void {
  const got = new Set(independent.map((i) => i.memberId));
  for (const id of expectedMemberIds) {
    if (!got.has(id as IndependentAnalysis['memberId'])) {
      throw new Error(`Debate blocked: missing independent analysis for ${id}`);
    }
  }
}

export function stripPeersForIndependent(ctx: LlmContext): LlmContext {
  return {
    phase: 'independent',
    memberId: ctx.memberId,
    evidence: ctx.evidence,
  };
}
