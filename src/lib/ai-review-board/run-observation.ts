import type { DebateTurn, IndependentAnalysis, ReviewBoardRun, RevisionRecord } from './types';
import { revisionStatusImpliesChange } from './types';

/** 기존 debate/independent/revisions 배열에서만 집계. 없으면 null (추정 금지). */
export type RunObservationMetrics = {
  agreementCount: number | null;
  disagreementCount: number | null;
  weakEvidenceCount: number | null;
  revisionCount: number | null;
  partialRevisionCount: number | null;
  fullRevisionCount: number | null;
  unchangedCount: number | null;
  averageConfidence: number | null;
  confidenceSource: 'revision' | 'debate' | 'independent' | null;
  avgConfidenceBefore: number | null;
  avgConfidenceAfter: number | null;
};

function sumLengths(turns: DebateTurn[], key: keyof DebateTurn): number {
  return turns.reduce((n, t) => {
    const v = t[key];
    return n + (Array.isArray(v) ? v.length : 0);
  }, 0);
}

function avgConfidence(items: { confidence: number }[]): number | null {
  if (items.length === 0) return null;
  const sum = items.reduce((s, i) => s + (typeof i.confidence === 'number' ? i.confidence : 0), 0);
  return Number((sum / items.length).toFixed(3));
}

function avgNum(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(3));
}

function revisionSource(run: ReviewBoardRun): RevisionRecord[] | null {
  if (Array.isArray(run.revisions) && run.revisions.length > 0) return run.revisions;
  return null;
}

/**
 * Run 목록·Overview용 관찰 지표.
 * v4: revisions 우선; v3: debate.revisionStatus fallback.
 */
export function computeRunObservationMetrics(run: ReviewBoardRun): RunObservationMetrics {
  const debate = Array.isArray(run.debate) ? run.debate : [];
  const independent = Array.isArray(run.independent) ? run.independent : [];
  const revisions = revisionSource(run);

  if (debate.length === 0 && !revisions) {
    const avgInd = avgConfidence(independent as IndependentAnalysis[]);
    return {
      agreementCount: null,
      disagreementCount: null,
      weakEvidenceCount: null,
      revisionCount: null,
      partialRevisionCount: null,
      fullRevisionCount: null,
      unchangedCount: null,
      averageConfidence: avgInd,
      confidenceSource: avgInd === null ? null : 'independent',
      avgConfidenceBefore: null,
      avgConfidenceAfter: null,
    };
  }

  if (revisions) {
    return {
      agreementCount: debate.length ? sumLengths(debate, 'agreement') : null,
      disagreementCount: debate.length ? sumLengths(debate, 'disagreement') : null,
      weakEvidenceCount: debate.length ? sumLengths(debate, 'weakEvidence') : null,
      revisionCount: revisions.filter((r) => r.revised || revisionStatusImpliesChange(r.revisionStatus))
        .length,
      partialRevisionCount: revisions.filter((r) => r.revisionStatus === 'PARTIAL').length,
      fullRevisionCount: revisions.filter((r) => r.revisionStatus === 'FULL').length,
      unchangedCount: revisions.filter((r) => r.revisionStatus === 'UNCHANGED').length,
      averageConfidence: avgNum(revisions.map((r) => r.confidenceAfter)),
      confidenceSource: 'revision',
      avgConfidenceBefore: avgNum(revisions.map((r) => r.confidenceBefore)),
      avgConfidenceAfter: avgNum(revisions.map((r) => r.confidenceAfter)),
    };
  }

  const hasStatusField = debate.some((d) => typeof d.revisionStatus === 'string');
  const debateWithConf = debate.filter((d) => typeof d.confidence === 'number') as {
    confidence: number;
  }[];

  return {
    agreementCount: sumLengths(debate, 'agreement'),
    disagreementCount: sumLengths(debate, 'disagreement'),
    weakEvidenceCount: sumLengths(debate, 'weakEvidence'),
    revisionCount: debate.filter((d) =>
      d.revisionStatus
        ? revisionStatusImpliesChange(d.revisionStatus)
        : Boolean(d.revised),
    ).length,
    partialRevisionCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'PARTIAL').length
      : null,
    fullRevisionCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'FULL').length
      : null,
    unchangedCount: hasStatusField
      ? debate.filter((d) => d.revisionStatus === 'UNCHANGED').length
      : null,
    averageConfidence: avgConfidence(debateWithConf),
    confidenceSource: debateWithConf.length ? 'debate' : null,
    avgConfidenceBefore: null,
    avgConfidenceAfter: null,
  };
}

export function formatRunWhen(run: ReviewBoardRun): string {
  const raw = run.createdAt || run.updatedAt;
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

/** Admin Debate 탭: 신런 revisions 우선, 구런 debate fallback */
export function resolveMemberRevisionView(
  run: ReviewBoardRun,
  memberId: string,
): {
  source: 'revisions' | 'debate' | null;
  revisionStatus: string | null;
  revised: boolean | null;
  retainReason: string | null;
  revisionReason: string | null;
  changedClaims: string[];
  confidenceBefore: number | null;
  confidenceAfter: number | null;
  confidenceChangeReason: string | null;
  finalOpinion: string | null;
  originalOpinion: string | null;
  newEvidenceAccepted: string[];
  rejectedArguments: { argument: string; reason: string }[];
} {
  const rev = (run.revisions ?? []).find((r) => r.memberId === memberId);
  if (rev) {
    return {
      source: 'revisions',
      revisionStatus: rev.revisionStatus,
      revised: rev.revised,
      retainReason: rev.retainReason,
      revisionReason: rev.revisionReason,
      changedClaims: rev.changedClaims,
      confidenceBefore: rev.confidenceBefore,
      confidenceAfter: rev.confidenceAfter,
      confidenceChangeReason: rev.confidenceChangeReason,
      finalOpinion: rev.finalOpinion,
      originalOpinion: rev.originalOpinion,
      newEvidenceAccepted: rev.newEvidenceAccepted,
      rejectedArguments: rev.rejectedArguments,
    };
  }
  const deb = run.debate.find((d) => d.memberId === memberId);
  if (!deb) {
    return {
      source: null,
      revisionStatus: null,
      revised: null,
      retainReason: null,
      revisionReason: null,
      changedClaims: [],
      confidenceBefore: null,
      confidenceAfter: null,
      confidenceChangeReason: null,
      finalOpinion: null,
      originalOpinion: null,
      newEvidenceAccepted: [],
      rejectedArguments: [],
    };
  }
  return {
    source: 'debate',
    revisionStatus: deb.revisionStatus ?? (deb.revised ? 'PARTIAL?' : 'UNCHANGED?'),
    revised: deb.revised ?? null,
    retainReason: deb.revised ? null : deb.revisionReason ?? null,
    revisionReason: deb.revised ? deb.revisionReason ?? null : null,
    changedClaims: [],
    confidenceBefore: null,
    confidenceAfter: typeof deb.confidence === 'number' ? deb.confidence : null,
    confidenceChangeReason: null,
    finalOpinion: deb.finalOpinion ?? null,
    originalOpinion: deb.previousOpinion ?? null,
    newEvidenceAccepted: [],
    rejectedArguments: [],
  };
}
