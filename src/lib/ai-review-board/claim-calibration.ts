/**
 * v5 Claim Calibration — Claim → Evidence → supportLevel helpers.
 * Does NOT force PARTIAL/FULL or confidence drops.
 */
import type {
  CalibratedClaim,
  ClaimCalibration,
  ClaimEvidenceType,
  ClaimSupportLevel,
  CommitteeAnalystId,
  EvidenceImpact,
  EvidencePack,
  OverclaimRisk,
} from './types';
import {
  isClaimEvidenceType,
  isClaimSupportLevel,
  isEvidenceImpact,
  isOverclaimRisk,
} from './types';

/** 5 ind + 5 debate + 5 claimCalibration + 5 revision + critic + chairman */
export const EXPECTED_PIPELINE_LLM_CALLS = 22;

/** Aggregate keys that may appear in evidenceRefs */
export const EVIDENCE_REF_KEYS = [
  'userCount',
  'usersLast7d',
  'newUsersLast7d',
  'activeUsersLast7d',
  'postCount',
  'postsLast7d',
  'commentsLast7d',
  'viewsLast7d',
  'totalViews',
  'commentCount',
  'postsByCategory',
] as const;

export type EvidenceRefKey = (typeof EVIDENCE_REF_KEYS)[number];

export function isKnownEvidenceRef(ref: string): boolean {
  return (EVIDENCE_REF_KEYS as readonly string[]).includes(ref);
}

/** Metrics that are currently null/unknown by contract (or null in pack) */
export function isUnknownMetricInPack(ref: string, evidence: EvidencePack): boolean {
  if (ref === 'activeUsersLast7d' || ref === 'viewsLast7d') {
    const v = evidence.aggregates[ref as 'activeUsersLast7d' | 'viewsLast7d'];
    return v == null;
  }
  const agg = evidence.aggregates as Record<string, unknown>;
  if (ref in agg) return agg[ref] == null;
  return false;
}

const UNKNOWN_AS_NEGATIVE_RE =
  /\b(activeUsersLast7d|viewsLast7d)\b[^\n.]{0,80}\b(low|absent|zero|none|declin|stagnant|worse|심각|낮|없|악화|정체)/i;

const NEGATIVE_FROM_NULL_RE =
  /\b(null|unavailable|unknown|not measured|측정\s*불가)\b[^\n.]{0,60}\b(engagement|활성|조회|참여).{0,40}\b(low|심각|낮|crisis|정체)/i;

/** Treats UNKNOWN/null metrics as proof that engagement is low/bad. */
export function usesUnknownAsNegativeEvidence(
  claimText: string,
  evidenceType: ClaimEvidenceType,
  evidenceRefs: string[],
  reason: string,
): boolean {
  const blob = `${claimText}\n${reason}`;
  const refsUnknownish =
    evidenceRefs.includes('activeUsersLast7d') || evidenceRefs.includes('viewsLast7d');
  if (evidenceType === 'UNKNOWN' && /낮|없|low|zero|crisis|정체|심각/.test(blob)) {
    return true;
  }
  if (refsUnknownish && UNKNOWN_AS_NEGATIVE_RE.test(blob)) return true;
  if (NEGATIVE_FROM_NULL_RE.test(blob)) return true;
  return false;
}

const CAUSAL_RE =
  /(because|caused by|due to|leads to|results from|때문에|로 인해|원인|유발)/i;

/** Causal claim without direct behavioral evidence refs. */
export function isCausalClaimWithoutEvidence(
  claimText: string,
  evidenceType: ClaimEvidenceType,
  evidenceRefs: string[],
  supportLevel: ClaimSupportLevel,
): boolean {
  if (!CAUSAL_RE.test(claimText)) return false;
  if (evidenceType === 'DIRECT_FACT' && supportLevel === 'SUPPORTED') return false;
  const hasBehavior =
    evidenceRefs.some((r) =>
      ['newUsersLast7d', 'commentsLast7d', 'postsLast7d', 'activeUsersLast7d', 'viewsLast7d'].includes(
        r,
      ),
    ) && evidenceType === 'DIRECT_FACT';
  if (hasBehavior && supportLevel === 'SUPPORTED') return false;
  // UX/UI/Gemini causal without direct metrics
  if (/UX|UI|사용성|Gemini|AI\s*feature/i.test(claimText)) {
    return evidenceType === 'HYPOTHESIS' || supportLevel !== 'SUPPORTED';
  }
  return evidenceType === 'HYPOTHESIS' || supportLevel === 'NOT_SUPPORTED';
}

export function listClaimFlags(
  claim: CalibratedClaim,
  evidence: EvidencePack,
): string[] {
  const flags: string[] = [];
  for (const ref of claim.evidenceRefs) {
    if (!isKnownEvidenceRef(ref)) flags.push(`unknown_ref:${ref}`);
  }
  if (
    claim.evidenceType === 'DIRECT_FACT' &&
    claim.evidenceRefs.some((r) => isUnknownMetricInPack(r, evidence))
  ) {
    flags.push('direct_fact_on_null_metric');
  }
  if (
    usesUnknownAsNegativeEvidence(
      claim.claimText,
      claim.evidenceType,
      claim.evidenceRefs,
      claim.reason,
    )
  ) {
    flags.push('unknown_as_evidence');
  }
  if (
    isCausalClaimWithoutEvidence(
      claim.claimText,
      claim.evidenceType,
      claim.evidenceRefs,
      claim.supportLevel,
    )
  ) {
    flags.push('causal_without_evidence');
  }
  if (
    claim.riskOfOverclaiming === 'HIGH' ||
    (claim.supportLevel === 'PARTIALLY_SUPPORTED' &&
      /crisis|stagnant|정체|심각|platform-wide|전체\s*참여/i.test(claim.claimText))
  ) {
    flags.push('overclaim_risk');
  }
  return flags;
}

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  return String(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean);
}

export function normalizeCalibratedClaim(
  raw: unknown,
  index: number,
): CalibratedClaim {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const evidenceType: ClaimEvidenceType = isClaimEvidenceType(o.evidenceType)
    ? o.evidenceType
    : 'INFERENCE';
  const supportLevel: ClaimSupportLevel = isClaimSupportLevel(o.supportLevel)
    ? o.supportLevel
    : 'PARTIALLY_SUPPORTED';
  const evidenceImpact: EvidenceImpact = isEvidenceImpact(o.evidenceImpact)
    ? o.evidenceImpact
    : 'LOW';
  const riskOfOverclaiming: OverclaimRisk = isOverclaimRisk(o.riskOfOverclaiming)
    ? o.riskOfOverclaiming
    : 'LOW';

  return {
    claimId: asString(o.claimId, `C${String(index + 1).padStart(3, '0')}`),
    claimText: asString(o.claimText, ''),
    evidenceRefs: asStringArray(o.evidenceRefs),
    evidenceType,
    supportLevel,
    reason: asString(o.reason, ''),
    missingEvidence: asStringArray(o.missingEvidence),
    evidenceImpact,
    riskOfOverclaiming,
  };
}

export function normalizeClaimCalibration(
  memberId: CommitteeAnalystId,
  raw: unknown,
): ClaimCalibration {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const claimsRaw = Array.isArray(o.claims) ? o.claims : [];
  const claims = claimsRaw.map((c, i) => normalizeCalibratedClaim(c, i)).filter((c) => c.claimText);
  return { memberId, claims };
}

/** Summarize calibration for revision prompt (no forcing). */
export function formatCalibrationForRevisionPrompt(cal: ClaimCalibration): string {
  return JSON.stringify(
    {
      memberId: cal.memberId,
      claimSummary: cal.claims.map((c) => ({
        claimId: c.claimId,
        claimText: c.claimText,
        evidenceType: c.evidenceType,
        supportLevel: c.supportLevel,
        evidenceImpact: c.evidenceImpact,
        riskOfOverclaiming: c.riskOfOverclaiming,
        missingEvidence: c.missingEvidence,
        evidenceRefs: c.evidenceRefs,
      })),
      note: 'Use EvidencePack as final ground. Do not force PARTIAL/FULL. Soften only if calibration warrants.',
    },
    null,
    2,
  );
}

export function calibrationSuggestsSoftening(cal: ClaimCalibration): boolean {
  return cal.claims.some(
    (c) =>
      (c.supportLevel === 'PARTIALLY_SUPPORTED' || c.supportLevel === 'NOT_SUPPORTED') &&
      (c.evidenceImpact === 'HIGH' || c.evidenceImpact === 'CRITICAL'),
  );
}

export function countSupportLevels(cal: ClaimCalibration): Record<ClaimSupportLevel, number> {
  const out: Record<ClaimSupportLevel, number> = {
    SUPPORTED: 0,
    PARTIALLY_SUPPORTED: 0,
    NOT_SUPPORTED: 0,
  };
  for (const c of cal.claims) out[c.supportLevel] += 1;
  return out;
}
