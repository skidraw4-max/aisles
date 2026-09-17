/**
 * v6 Claim Calibration ↔ Revision consistency (deterministic; no extra LLM call).
 * Does NOT force PARTIAL/FULL — only flags logical mismatches.
 */
import type {
  CalibratedClaim,
  ClaimCalibration,
  ClaimSupportLevel,
  CommitteeAnalystId,
  ConsistencySeverity,
  ConsistencyStatus,
  EvidenceImpact,
  OverclaimRisk,
  RevisionAction,
  RevisionRecord,
  RevisionStatus,
} from './types';
import {
  isConsistencySeverity,
  isConsistencyStatus,
  isRevisionAction,
} from './types';
import { textUsesMajorityAsGround } from './revision-quality';
import {
  isCausalClaimWithoutEvidence,
  usesUnknownAsNegativeEvidence,
} from './claim-calibration';

export const REVISION_ACTIONS = [
  'REWORD',
  'NARROW',
  'DOWNGRADE_CONFIDENCE',
  'ADD_CAVEAT',
  'RETAIN_WITH_JUSTIFICATION',
  'NO_ACTION_NEEDED',
] as const;

export type CalibrationRevisionMismatchFlag =
  | 'CALIBRATION_REVISION_MISMATCH'
  | 'OVERCLAIM_RETAINED'
  | 'UNKNOWN_AS_NEGATIVE_EVIDENCE'
  | 'CAUSAL_CLAIM_WITHOUT_EVIDENCE'
  | 'CONFIDENCE_UNJUSTIFIED'
  | 'MAJORITY_DRIVEN_REVISION'
  | 'SUPPORTED_FACT_UNNECESSARILY_DOWNGRADED';

const SOFTENING_ACTIONS: RevisionAction[] = [
  'REWORD',
  'NARROW',
  'DOWNGRADE_CONFIDENCE',
  'ADD_CAVEAT',
];

export function needsSofteningAttention(claim: CalibratedClaim): boolean {
  return (
    claim.supportLevel === 'PARTIALLY_SUPPORTED' &&
    (claim.evidenceImpact === 'HIGH' || claim.evidenceImpact === 'CRITICAL') &&
    (claim.riskOfOverclaiming === 'MEDIUM' || claim.riskOfOverclaiming === 'HIGH')
  );
}

function justificationMentionsClaim(
  text: string | null | undefined,
  claim: CalibratedClaim,
): boolean {
  if (!text || !text.trim()) return false;
  const t = text.toLowerCase();
  if (t.includes(claim.claimId.toLowerCase())) return true;
  // partial phrase match on claim text (≥12 chars chunk)
  const chunk = claim.claimText.slice(0, 24).toLowerCase();
  if (chunk.length >= 8 && t.includes(chunk.slice(0, Math.min(16, chunk.length)))) {
    return true;
  }
  if (/evidence\s*gap|null|activeUsers|viewsLast7d|부분|근거\s*부족|overclaim|caveat/i.test(text)) {
    return true;
  }
  return false;
}

function confidenceJustified(rev: RevisionRecord, hasHighGap: boolean): boolean {
  if (!hasHighGap) return true;
  if (rev.confidenceAfter < rev.confidenceBefore) return true;
  const reason = `${rev.confidenceChangeReason || ''}\n${rev.retainReason || ''}`;
  if (!reason.trim()) return false;
  return /confidence|확신|유지|gap|null|partial|부족|impact|evidence/i.test(reason);
}

export type ConsistencyCheckInput = {
  memberId: CommitteeAnalystId;
  claim: CalibratedClaim;
  revision: RevisionRecord;
  revisionAction?: RevisionAction | null;
  actionReason?: string | null;
};

export type ConsistencyCheckResult = {
  memberId: CommitteeAnalystId;
  claimId: string;
  calibrationSupportLevel: ClaimSupportLevel;
  calibrationEvidenceImpact: EvidenceImpact;
  calibrationRiskOfOverclaiming: OverclaimRisk;
  revisionStatus: RevisionStatus;
  revisionAction: RevisionAction;
  consistency: ConsistencyStatus;
  severity: ConsistencySeverity;
  reason: string;
  flags: CalibrationRevisionMismatchFlag[];
};

/**
 * Evaluate one calibrated claim against one member's revision.
 */
export function evaluateClaimRevisionConsistency(
  input: ConsistencyCheckInput,
): ConsistencyCheckResult {
  const { memberId, claim, revision } = input;
  const action: RevisionAction =
    input.revisionAction && isRevisionAction(input.revisionAction)
      ? input.revisionAction
      : inferRevisionAction(claim, revision);
  const actionReason = input.actionReason ?? '';
  const justifyText = [
    revision.retainReason,
    revision.revisionReason,
    revision.confidenceChangeReason,
    actionReason,
    revision.finalOpinion,
  ]
    .filter(Boolean)
    .join('\n');

  const flags: CalibrationRevisionMismatchFlag[] = [];
  let consistency: ConsistencyStatus = 'CONSISTENT';
  let severity: ConsistencySeverity = 'INFO';
  let reason = 'Calibration and revision aligned';

  const softNeeded = needsSofteningAttention(claim);
  const softened = SOFTENING_ACTIONS.includes(action);
  const retainJustified =
    action === 'RETAIN_WITH_JUSTIFICATION' &&
    justificationMentionsClaim(justifyText, claim);

  // Majority-driven
  if (
    textUsesMajorityAsGround(revision.revisionReason) ||
    textUsesMajorityAsGround(revision.retainReason) ||
    textUsesMajorityAsGround(revision.confidenceChangeReason)
  ) {
    flags.push('MAJORITY_DRIVEN_REVISION');
  }

  // Unknown as negative in final opinion
  if (
    usesUnknownAsNegativeEvidence(
      revision.finalOpinion,
      claim.evidenceType,
      claim.evidenceRefs,
      justifyText,
    ) ||
    (claim.evidenceType === 'UNKNOWN' &&
      /활동량이\s*매우\s*낮|거의\s*활동하지|engagement\s+is\s+very\s+low|critically\s+low\s+activity/i.test(
        revision.finalOpinion,
      ))
  ) {
    flags.push('UNKNOWN_AS_NEGATIVE_EVIDENCE');
  }

  // Causal without evidence retained
  if (
    (claim.evidenceType === 'HYPOTHESIS' || claim.supportLevel === 'NOT_SUPPORTED') &&
    isCausalClaimWithoutEvidence(
      revision.finalOpinion,
      claim.evidenceType,
      claim.evidenceRefs,
      claim.supportLevel,
    )
  ) {
    flags.push('CAUSAL_CLAIM_WITHOUT_EVIDENCE');
  }
  if (
    (claim.evidenceType === 'HYPOTHESIS' || claim.supportLevel === 'NOT_SUPPORTED') &&
    /때문에|caused by|due to|원인/.test(revision.finalOpinion) &&
    revision.revisionStatus === 'UNCHANGED' &&
    !/가능성|가설|확인할\s*수\s*없|cannot\s+confirm|hypothesis/i.test(revision.finalOpinion)
  ) {
    if (!flags.includes('CAUSAL_CLAIM_WITHOUT_EVIDENCE')) {
      flags.push('CAUSAL_CLAIM_WITHOUT_EVIDENCE');
    }
  }

  // Overclaim retained
  if (
    (claim.riskOfOverclaiming === 'HIGH' || claim.riskOfOverclaiming === 'MEDIUM') &&
    softNeeded &&
    revision.revisionStatus === 'UNCHANGED' &&
    !softened &&
    !retainJustified &&
    action === 'NO_ACTION_NEEDED'
  ) {
    flags.push('OVERCLAIM_RETAINED');
    flags.push('CALIBRATION_REVISION_MISMATCH');
  }

  if (
    softNeeded &&
    revision.revisionStatus === 'UNCHANGED' &&
    !softened &&
    !retainJustified
  ) {
    if (!flags.includes('CALIBRATION_REVISION_MISMATCH')) {
      flags.push('CALIBRATION_REVISION_MISMATCH');
    }
  }

  // Confidence unjustified
  const hasHighGap =
    claim.evidenceImpact === 'HIGH' || claim.evidenceImpact === 'CRITICAL';
  if (
    hasHighGap &&
    revision.confidenceAfter === revision.confidenceBefore &&
    !confidenceJustified(revision, hasHighGap)
  ) {
    flags.push('CONFIDENCE_UNJUSTIFIED');
  }

  // Supported fact unnecessarily downgraded
  if (
    claim.evidenceType === 'DIRECT_FACT' &&
    claim.supportLevel === 'SUPPORTED' &&
    claim.riskOfOverclaiming === 'LOW' &&
    revision.revisionStatus === 'PARTIAL' &&
    /부족|insufficient|weaken|약화/.test(revision.revisionReason || '') &&
    !revision.changedClaims.some((c) => /caveat|범위|scoped/i.test(c))
  ) {
    flags.push('SUPPORTED_FACT_UNNECESSARILY_DOWNGRADED');
  }

  // Resolve consistency
  if (flags.includes('CALIBRATION_REVISION_MISMATCH') || flags.includes('OVERCLAIM_RETAINED')) {
    consistency = 'INCONSISTENT';
    severity = 'HIGH';
    reason =
      'PARTIALLY_SUPPORTED + HIGH impact retained as UNCHANGED without adequate claim-level justification';
  } else if (
    flags.includes('UNKNOWN_AS_NEGATIVE_EVIDENCE') ||
    flags.includes('CAUSAL_CLAIM_WITHOUT_EVIDENCE')
  ) {
    consistency = 'INCONSISTENT';
    severity = 'HIGH';
    reason = flags.join(', ');
  } else if (flags.includes('MAJORITY_DRIVEN_REVISION')) {
    consistency = 'INCONSISTENT';
    severity = 'MEDIUM';
    reason = 'Majority agreement used as revision/retain ground';
  } else if (flags.includes('CONFIDENCE_UNJUSTIFIED')) {
    consistency = 'PARTIALLY_CONSISTENT';
    severity = 'MEDIUM';
    reason = 'High evidence gap but confidence unchanged without justification';
  } else if (flags.includes('SUPPORTED_FACT_UNNECESSARILY_DOWNGRADED')) {
    consistency = 'PARTIALLY_CONSISTENT';
    severity = 'LOW';
    reason = 'DIRECT_FACT SUPPORTED claim weakened without clear need';
  } else if (
    softNeeded &&
    revision.revisionStatus === 'UNCHANGED' &&
    retainJustified
  ) {
    consistency = 'CONSISTENT';
    severity = 'INFO';
    reason = 'UNCHANGED with RETAIN_WITH_JUSTIFICATION addressing calibration gaps';
  } else if (softNeeded && softened) {
    consistency = 'CONSISTENT';
    severity = 'INFO';
    reason = `Softening action ${action} applied for high-impact partial claim`;
  } else if (
    claim.supportLevel === 'SUPPORTED' &&
    claim.evidenceType === 'DIRECT_FACT' &&
    revision.revisionStatus === 'UNCHANGED'
  ) {
    consistency = 'CONSISTENT';
    severity = 'INFO';
    reason = 'Supported direct fact retained';
  }

  return {
    memberId,
    claimId: claim.claimId,
    calibrationSupportLevel: claim.supportLevel,
    calibrationEvidenceImpact: claim.evidenceImpact,
    calibrationRiskOfOverclaiming: claim.riskOfOverclaiming,
    revisionStatus: revision.revisionStatus,
    revisionAction: action,
    consistency,
    severity,
    reason,
    flags,
  };
}

export function inferRevisionAction(
  claim: CalibratedClaim,
  revision: RevisionRecord,
): RevisionAction {
  const assessed = revision.calibrationImpactAssessment?.affectedClaims?.find(
    (a) => a.claimId === claim.claimId,
  );
  if (assessed && isRevisionAction(assessed.revisionAction)) {
    return assessed.revisionAction;
  }
  if (revision.revisionStatus === 'UNCHANGED') {
    if (needsSofteningAttention(claim)) {
      const ok = justificationMentionsClaim(
        `${revision.retainReason}\n${revision.confidenceChangeReason}`,
        claim,
      );
      return ok ? 'RETAIN_WITH_JUSTIFICATION' : 'NO_ACTION_NEEDED';
    }
    return 'NO_ACTION_NEEDED';
  }
  if (revision.confidenceAfter < revision.confidenceBefore) {
    return 'DOWNGRADE_CONFIDENCE';
  }
  if (/caveat|단서|제한|cannot conclusively|unknown/i.test(revision.finalOpinion)) {
    return 'ADD_CAVEAT';
  }
  if (/narrow|범위|scoped|soften|완화/i.test(revision.revisionReason || '')) {
    return 'NARROW';
  }
  return 'REWORD';
}

export function runCalibrationRevisionChecks(
  calibrations: ClaimCalibration[],
  revisions: RevisionRecord[],
): ConsistencyCheckResult[] {
  const results: ConsistencyCheckResult[] = [];
  for (const cal of calibrations) {
    const rev = revisions.find((r) => r.memberId === cal.memberId);
    if (!rev) continue;
    for (const claim of cal.claims) {
      const assessed = rev.calibrationImpactAssessment?.affectedClaims?.find(
        (a) => a.claimId === claim.claimId,
      );
      results.push(
        evaluateClaimRevisionConsistency({
          memberId: cal.memberId,
          claim,
          revision: rev,
          revisionAction: assessed?.revisionAction,
          actionReason: assessed?.actionReason,
        }),
      );
    }
  }
  return results;
}

export function summarizeConsistency(checks: ConsistencyCheckResult[]): {
  consistent: number;
  partiallyConsistent: number;
  inconsistent: number;
  flagCounts: Record<string, number>;
} {
  const flagCounts: Record<string, number> = {};
  let consistent = 0;
  let partiallyConsistent = 0;
  let inconsistent = 0;
  for (const c of checks) {
    if (c.consistency === 'CONSISTENT') consistent += 1;
    else if (c.consistency === 'PARTIALLY_CONSISTENT') partiallyConsistent += 1;
    else inconsistent += 1;
    for (const f of c.flags) {
      flagCounts[f] = (flagCounts[f] || 0) + 1;
    }
  }
  return { consistent, partiallyConsistent, inconsistent, flagCounts };
}

/** Merge deterministic consistency results into CriticReport fields (no LLM). */
export function buildCriticConsistencyOverlay(checks: ConsistencyCheckResult[]): {
  calibrationRevisionIntegrity: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  calibrationRevisionMismatchFlags: { ok: boolean; flags: string[] };
  overclaimRetainedFlags: { ok: boolean; flags: string[] };
  unknownAsNegativeEvidenceFlags: { ok: boolean; flags: string[] };
  causalClaimWithoutEvidenceFlags: { ok: boolean; flags: string[] };
  unjustifiedConfidenceFlags: { ok: boolean; flags: string[] };
  majorityDrivenRevisionFlags: { ok: boolean; flags: string[] };
} {
  const byFlag = (flag: CalibrationRevisionMismatchFlag) =>
    checks
      .filter((c) => c.flags.includes(flag))
      .map((c) => `${c.memberId}:${c.claimId}:${flag}`);

  const mismatch = byFlag('CALIBRATION_REVISION_MISMATCH');
  const overclaim = byFlag('OVERCLAIM_RETAINED');
  const unknownNeg = byFlag('UNKNOWN_AS_NEGATIVE_EVIDENCE');
  const causal = byFlag('CAUSAL_CLAIM_WITHOUT_EVIDENCE');
  const conf = byFlag('CONFIDENCE_UNJUSTIFIED');
  const majority = byFlag('MAJORITY_DRIVEN_REVISION');
  const sum = summarizeConsistency(checks);
  const issues = checks
    .filter((c) => c.consistency !== 'CONSISTENT')
    .map(
      (c) =>
        `${c.memberId}/${c.claimId}: ${c.consistency} [${c.flags.join(',')}] — ${c.reason}`,
    );
  let status: 'PASS' | 'WARN' | 'FAIL' = 'PASS';
  if (sum.inconsistent > 0) status = 'FAIL';
  else if (sum.partiallyConsistent > 0) status = 'WARN';

  return {
    calibrationRevisionIntegrity: {
      status,
      issues,
      summary: `consistent=${sum.consistent} partial=${sum.partiallyConsistent} inconsistent=${sum.inconsistent}`,
    },
    calibrationRevisionMismatchFlags: { ok: mismatch.length === 0, flags: mismatch },
    overclaimRetainedFlags: { ok: overclaim.length === 0, flags: overclaim },
    unknownAsNegativeEvidenceFlags: { ok: unknownNeg.length === 0, flags: unknownNeg },
    causalClaimWithoutEvidenceFlags: { ok: causal.length === 0, flags: causal },
    unjustifiedConfidenceFlags: { ok: conf.length === 0, flags: conf },
    majorityDrivenRevisionFlags: { ok: majority.length === 0, flags: majority },
  };
}

export function toCalibrationRevisionChecks(
  results: ConsistencyCheckResult[],
): import('./types').CalibrationRevisionCheck[] {
  return results.map((r) => ({
    memberId: r.memberId,
    claimId: r.claimId,
    calibrationSupportLevel: r.calibrationSupportLevel,
    calibrationEvidenceImpact: r.calibrationEvidenceImpact,
    calibrationRiskOfOverclaiming: r.calibrationRiskOfOverclaiming,
    revisionStatus: r.revisionStatus,
    revisionAction: r.revisionAction,
    consistency: r.consistency,
    severity: r.severity,
    reason: r.reason,
    flags: r.flags,
  }));
}

export function formatCalibrationRevisionFindings(checks: ConsistencyCheckResult[]): string[] {
  const sum = summarizeConsistency(checks);
  const findings = [
    `Consistency: CONSISTENT=${sum.consistent}, PARTIALLY_CONSISTENT=${sum.partiallyConsistent}, INCONSISTENT=${sum.inconsistent}`,
  ];
  for (const [flag, n] of Object.entries(sum.flagCounts)) {
    findings.push(`${flag}: ${n}`);
  }
  const notable = checks
    .filter((c) => c.consistency !== 'CONSISTENT')
    .slice(0, 8)
    .map((c) => `${c.memberId}/${c.claimId} ${c.consistency}: ${c.reason}`);
  return [...findings, ...notable];
}

export function parseConsistencyRow(raw: unknown): ConsistencyCheckResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.memberId !== 'string' || typeof o.claimId !== 'string') return null;
  return {
    memberId: o.memberId as CommitteeAnalystId,
    claimId: String(o.claimId),
    calibrationSupportLevel: o.calibrationSupportLevel as ClaimSupportLevel,
    calibrationEvidenceImpact: o.calibrationEvidenceImpact as EvidenceImpact,
    calibrationRiskOfOverclaiming: o.calibrationRiskOfOverclaiming as OverclaimRisk,
    revisionStatus: o.revisionStatus as RevisionStatus,
    revisionAction: isRevisionAction(o.revisionAction)
      ? o.revisionAction
      : 'NO_ACTION_NEEDED',
    consistency: isConsistencyStatus(o.consistency) ? o.consistency : 'PARTIALLY_CONSISTENT',
    severity: isConsistencySeverity(o.severity) ? o.severity : 'INFO',
    reason: typeof o.reason === 'string' ? o.reason : '',
    flags: Array.isArray(o.flags) ? (o.flags as CalibrationRevisionMismatchFlag[]) : [],
  };
}
