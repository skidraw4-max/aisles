/**
 * v4 revision quality helpers — herding phrase detection, record normalization.
 * Does NOT force PARTIAL/FULL; only validates shape and flags majority-as-ground.
 */
import type {
  CommitteeAnalystId,
  RejectedArgument,
  RevisionAnswers,
  RevisionRecord,
  RevisionStatus,
} from './types';
import { isRevisionStatus, revisionStatusImpliesChange } from './types';

const HERDING_GROUND_RE =
  /\b(all reviewers agree|the majority agrees?|consensus supports|other reviewers confirmed|peers?\s+agree|majority consensus)\b|다른\s*리뷰어(들)?이?\s*동의|다수\s*(의견|합의)|동료들이\s*동의|전원\s*동의/i;

export function textUsesMajorityAsGround(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  return HERDING_GROUND_RE.test(text);
}

/** Majority agreement alone must not justify raising confidence. */
export function majorityAloneCannotRaiseConfidence(
  confidenceBefore: number,
  confidenceAfter: number,
  changeReason: string | null | undefined,
): boolean {
  if (confidenceAfter <= confidenceBefore) return true;
  return !textUsesMajorityAsGround(changeReason);
}

export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

export function emptyRevisionAnswers(): RevisionAnswers {
  return {
    q1_coreClaim: '',
    q2_strongestRebuttal: '',
    q3_rebuttalEvidenceKind: '',
    q4_evidenceGapsFound: '',
    q5_gapAffectsCoreClaim: '',
    q6_directlySupportedScope: '',
    q7_overclaimCheck: '',
    q8_whyRetainIfUnchanged: '',
    q9_claimsToChangeIfPartial: '',
    q10_groundsForFullRevision: '',
    q11_chosenStatus: 'UNCHANGED',
    q12_confidenceChange: '',
  };
}

export function parseRevisionAnswers(raw: unknown): RevisionAnswers {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = isRevisionStatus(o.q11_chosenStatus) ? o.q11_chosenStatus : 'UNCHANGED';
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    q1_coreClaim: s(o.q1_coreClaim),
    q2_strongestRebuttal: s(o.q2_strongestRebuttal),
    q3_rebuttalEvidenceKind: s(o.q3_rebuttalEvidenceKind),
    q4_evidenceGapsFound: s(o.q4_evidenceGapsFound),
    q5_gapAffectsCoreClaim: s(o.q5_gapAffectsCoreClaim),
    q6_directlySupportedScope: s(o.q6_directlySupportedScope),
    q7_overclaimCheck: s(o.q7_overclaimCheck),
    q8_whyRetainIfUnchanged: s(o.q8_whyRetainIfUnchanged),
    q9_claimsToChangeIfPartial: s(o.q9_claimsToChangeIfPartial),
    q10_groundsForFullRevision: s(o.q10_groundsForFullRevision),
    q11_chosenStatus: status,
    q12_confidenceChange: s(o.q12_confidenceChange),
  };
}

export function parseRejectedArguments(raw: unknown): RejectedArgument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      const argument = typeof o.argument === 'string' ? o.argument : '';
      const reason = typeof o.reason === 'string' ? o.reason : '';
      if (!argument && !reason) return null;
      return { argument, reason };
    })
    .filter((x): x is RejectedArgument => x !== null);
}

export type RevisionIntegrityIssue =
  | 'missing_retainReason'
  | 'missing_revisionReason'
  | 'status_revised_mismatch'
  | 'majority_as_retain_ground'
  | 'majority_as_revision_ground'
  | 'majority_raises_confidence'
  | 'partial_without_changedClaims'
  | 'unchanged_with_changedClaims';

export function listRevisionIntegrityIssues(r: RevisionRecord): RevisionIntegrityIssue[] {
  const issues: RevisionIntegrityIssue[] = [];
  const changed = revisionStatusImpliesChange(r.revisionStatus);
  if (r.revised !== changed) issues.push('status_revised_mismatch');
  if (!changed) {
    if (!r.retainReason?.trim()) issues.push('missing_retainReason');
    if (textUsesMajorityAsGround(r.retainReason)) issues.push('majority_as_retain_ground');
    if (r.changedClaims.length > 0) issues.push('unchanged_with_changedClaims');
  } else {
    if (!r.revisionReason?.trim()) issues.push('missing_revisionReason');
    if (textUsesMajorityAsGround(r.revisionReason)) issues.push('majority_as_revision_ground');
    if (r.revisionStatus === 'PARTIAL' && r.changedClaims.length === 0) {
      issues.push('partial_without_changedClaims');
    }
  }
  if (
    r.confidenceAfter > r.confidenceBefore &&
    textUsesMajorityAsGround(r.confidenceChangeReason)
  ) {
    issues.push('majority_raises_confidence');
  }
  return issues;
}

export type NormalizeRevisionInput = {
  memberId: CommitteeAnalystId;
  originalOpinion: string;
  confidenceBefore: number;
  revisionStatus?: unknown;
  revised?: unknown;
  revisionReason?: unknown;
  retainReason?: unknown;
  changedClaims?: unknown;
  newEvidenceAccepted?: unknown;
  rejectedArguments?: unknown;
  confidenceAfter?: unknown;
  confidenceChangeReason?: unknown;
  finalOpinion?: unknown;
  revisionAnswers?: unknown;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.length > 0);
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  return String(v);
}

/**
 * Normalize LLM/mock revision JSON into a RevisionRecord.
 * Does not invent PARTIAL/FULL — defaults missing status to UNCHANGED.
 */
export function normalizeRevisionRecord(input: NormalizeRevisionInput): RevisionRecord {
  let revisionStatus: RevisionStatus = isRevisionStatus(input.revisionStatus)
    ? input.revisionStatus
    : Boolean(input.revised)
      ? 'PARTIAL'
      : 'UNCHANGED';

  const answers = parseRevisionAnswers(input.revisionAnswers);
  if (isRevisionStatus(answers.q11_chosenStatus) && !isRevisionStatus(input.revisionStatus)) {
    revisionStatus = answers.q11_chosenStatus;
  }
  answers.q11_chosenStatus = revisionStatus;

  const revised = revisionStatusImpliesChange(revisionStatus);
  const confidenceBefore = clampConfidence(
    typeof input.confidenceBefore === 'number' ? input.confidenceBefore : 0.5,
  );
  let confidenceAfter = clampConfidence(
    typeof input.confidenceAfter === 'number' ? input.confidenceAfter : confidenceBefore,
  );

  // Soft guard: majority-alone must not raise confidence
  const changeReason = asString(input.confidenceChangeReason, answers.q12_confidenceChange);
  if (
    confidenceAfter > confidenceBefore &&
    textUsesMajorityAsGround(changeReason)
  ) {
    confidenceAfter = confidenceBefore;
  }

  const retainReason = revised
    ? null
    : asString(input.retainReason, answers.q8_whyRetainIfUnchanged) ||
      'Reviewed strongest rebuttal; independent evidence still supports core claim.';

  const revisionReason = revised
    ? asString(input.revisionReason) || 'Adjusted claims after evidence/rebuttal review'
    : null;

  let changedClaims = asStringArray(input.changedClaims);
  if (!revised) changedClaims = [];
  if (revised && revisionStatus === 'PARTIAL' && changedClaims.length === 0) {
    const fromQ = asString(answers.q9_claimsToChangeIfPartial);
    if (fromQ) changedClaims = [fromQ];
  }

  return {
    memberId: input.memberId,
    revisionStatus,
    revised,
    originalOpinion: input.originalOpinion,
    revisionReason,
    retainReason,
    changedClaims,
    newEvidenceAccepted: asStringArray(input.newEvidenceAccepted),
    rejectedArguments: parseRejectedArguments(input.rejectedArguments),
    confidenceBefore,
    confidenceAfter,
    confidenceChangeReason:
      changeReason ||
      (confidenceAfter === confidenceBefore
        ? 'confidence unchanged after revision checklist'
        : 'confidence adjusted after revision checklist'),
    finalOpinion: asString(input.finalOpinion, input.originalOpinion),
    revisionAnswers: answers,
  };
}

/** Expected Gemini/mock pipeline LLM calls — see claim-calibration.ts (v5 = 22) */
export { EXPECTED_PIPELINE_LLM_CALLS } from './claim-calibration';
