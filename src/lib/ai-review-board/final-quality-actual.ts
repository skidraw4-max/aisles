import type { FinalReport, ReviewBoardRun } from './types';

/**
 * Chairman user-facing reading used by Jury Product and the evaluation comparator.
 * Judge, Critic, and Revision lineage are provenance and are not read here.
 */

export type FinalQualityEvidenceStrength = 'weak' | 'moderate' | 'strong' | 'unknown';
export type FinalQualityClaimStrength = 'weak' | 'moderate' | 'strong' | 'extreme';
export type FinalQualityDecision = 'ACCEPT' | 'CAVEAT' | 'REWORD' | 'NARROW' | 'REJECT' | 'VERIFY';

export type FinalQualityActual = {
  evidenceStrength: FinalQualityEvidenceStrength;
  claimStrength: FinalQualityClaimStrength;
  conflictDetected: boolean;
  overclaimDetected: boolean;
  revisionRequired: boolean;
  expectedDecision: FinalQualityDecision;
};

const EXTREME_LEX = /fundamentally|critical data integrity|community failure/i;
const STRONG_LEX = /extremely|severe|critical/i;
const STRONG_EVAL =
  /\b(extremely|severe(?:ly)?|critic(?:al|ally)|fundamentally|complete failure)\b/i;
const CAUSAL = /\b(due to|because|caused by|not finding value)\b/i;

/**
 * Chairman user-facing surface only.
 * confirmedFacts are ground truth for overclaim checks, not evaluative claims.
 */
function eachSurfaceText(final: FinalReport | null | undefined): string[] {
  if (!final) return [];
  return [
    final.statusSummary ?? '',
    ...(final.topProblems ?? []),
    final.expectedUserEffect ?? '',
    final.risk ?? '',
    ...(final.dimensionScores ?? []).flatMap((d) => (d.evidence ?? []).map((e) => e.text ?? '')),
    ...(final.supportedClaims ?? []),
    ...(final.partiallySupportedClaims ?? []),
    ...(final.hypotheses ?? []),
  ];
}

function evaluativeSurface(final: FinalReport | null | undefined): string {
  return eachSurfaceText(final).join(' ');
}

function postsMeasuredAsNull(run: ReviewBoardRun): boolean {
  const ag = run.evidence?.aggregates;
  const facts = (run.final?.confirmedFacts ?? []).join('\n');
  return ag?.postsLast7d == null || /postsLast7d is null/i.test(facts);
}

function hasUnhedgedCausal(surface: string): boolean {
  const hedgedDueTo =
    /\b(?:may|might|could|possibly|potentially)\b(?:\s+\w+){0,3}\s+due to\b/gi;
  return CAUSAL.test(surface.replace(hedgedDueTo, ' '));
}

function surfaceOverclaim(run: ReviewBoardRun, surface: string): boolean {
  if (STRONG_EVAL.test(surface) || hasUnhedgedCausal(surface)) return true;
  if (!postsMeasuredAsNull(run)) return false;
  return eachSurfaceText(run.final).some((text) => /\b0 posts\b/i.test(text));
}

function isMeasuredNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function measuredSide(primary: unknown, catalogValue: unknown): unknown {
  if (isMeasuredNumber(primary)) return primary;
  if (isMeasuredNumber(catalogValue)) return catalogValue;
  return null;
}

function catalogValue(run: ReviewBoardRun, id: string): unknown {
  return run.evidence?.evidenceItems?.find((item) => item.id === id)?.value;
}

/**
 * Same catalog metric, two finite values, and they differ.
 * A measured value next to null is missing coverage, not a contradiction.
 * Chairman strings and opinionDifferences are not read here.
 */
function hasMeasuredContradiction(run: ReviewBoardRun): boolean {
  const ag = run.evidence?.aggregates;
  const g = run.evidence?.ga4;
  const pairs: Array<[unknown, unknown]> = [
    [
      measuredSide(g?.users?.newUsers, catalogValue(run, 'GA_NEW_USERS_7D')),
      measuredSide(ag?.newUsersLast7d, catalogValue(run, 'DB_NEW_USERS_7D')),
    ],
    [
      measuredSide(
        g?.metrics?.activeUsers ?? g?.users?.activeUsers,
        catalogValue(run, 'GA_ACTIVE_USERS_7D'),
      ),
      measuredSide(ag?.activeUsersLast7d, catalogValue(run, 'DB_ACTIVE_USERS_7D')),
    ],
    [
      measuredSide(
        g?.metrics?.screenPageViews ?? g?.views?.screenPageViews,
        catalogValue(run, 'GA_SCREEN_PAGE_VIEWS_7D'),
      ),
      measuredSide(ag?.viewsLast7d, catalogValue(run, 'DB_VIEWS_7D')),
    ],
  ];
  return pairs.some(
    ([left, right]) => isMeasuredNumber(left) && isMeasuredNumber(right) && left !== right,
  );
}

function hasOtherMeasuredEvidence(run: ReviewBoardRun): boolean {
  const ag = run.evidence?.aggregates;
  const aggregateOthers = [
    ag?.userCount,
    ag?.usersLast7d,
    ag?.postCount,
    ag?.postsLast7d,
    ag?.viewsLast7d,
    ag?.totalViews,
    ag?.commentCount,
    ...Object.values(ag?.postsByCategory ?? {}),
  ];
  if (aggregateOthers.some(isMeasuredNumber)) return true;
  const metrics = run.evidence?.ga4?.metrics;
  if (!metrics) return false;
  const gaNumbers = [
    metrics.sessions,
    metrics.activeUsers,
    metrics.screenPageViews,
    metrics.engagedSessions,
    metrics.averageSessionDurationSec,
    ...Object.values(metrics.eventCountByName ?? {}),
  ];
  return gaNumbers.some(isMeasuredNumber);
}

function inferEvidenceStrength(run: ReviewBoardRun): FinalQualityEvidenceStrength {
  const ag = run.evidence?.aggregates;
  const primary = [ag?.newUsersLast7d, ag?.activeUsersLast7d, ag?.commentsLast7d];
  if (primary.some(isMeasuredNumber)) return 'strong';
  if (hasOtherMeasuredEvidence(run)) return 'moderate';
  return 'unknown';
}

function inferClaimStrength(surface: string): FinalQualityClaimStrength {
  if (EXTREME_LEX.test(surface)) return 'extreme';
  if (STRONG_LEX.test(surface)) return 'strong';
  return 'weak';
}

function inferDecision(p: {
  overclaimDetected: boolean;
  conflictDetected: boolean;
  revisionRequired: boolean;
}): FinalQualityDecision {
  if (p.conflictDetected && !p.overclaimDetected) return 'VERIFY';
  if (p.overclaimDetected && p.revisionRequired) return 'REWORD';
  if (p.overclaimDetected) return 'CAVEAT';
  if (p.revisionRequired) return 'NARROW';
  return 'ACCEPT';
}

/**
 * Heuristic extraction from a Board run for structured comparison.
 * Final quality is the Chairman user-facing surface only.
 */
export function extractActualFromRun(run: ReviewBoardRun): FinalQualityActual {
  const final = run.final;
  const surface = evaluativeSurface(final);
  const overclaimDetected = surfaceOverclaim(run, surface);
  const conflictDetected = hasMeasuredContradiction(run);
  const revisionRequired = overclaimDetected;
  const evidenceStrength = inferEvidenceStrength(run);
  const claimStrength = inferClaimStrength(surface);
  const expectedDecision = inferDecision({
    overclaimDetected,
    conflictDetected,
    revisionRequired,
  });

  return {
    evidenceStrength,
    claimStrength,
    conflictDetected,
    overclaimDetected,
    revisionRequired,
    expectedDecision,
  };
}
