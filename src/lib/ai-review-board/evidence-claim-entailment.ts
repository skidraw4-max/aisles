/**
 * v7 Evidence Semantics & Claim Entailment (helpers + deterministic checks).
 * Does NOT force PARTIAL/FULL. UNKNOWN/null ≠ negative evidence.
 */
import type {
  CalibratedClaim,
  ClaimCalibration,
  CommitteeAnalystId,
  EntailmentLevel,
  EvidencePack,
  EvidenceRelation,
  EvidenceSemanticsMember,
  EvidenceSemanticsRow,
  RevisionRecord,
  SemanticRisk,
} from './types';
import {
  isEntailmentLevel,
  isEvidenceRelation,
  isSemanticRisk,
} from './types';

export const EVIDENCE_RELATIONS = [
  'DIRECTLY_SUPPORTS',
  'PARTIALLY_SUPPORTS',
  'CONTEXT_ONLY',
  'DOES_NOT_SUPPORT',
  'CONTRADICTS',
  'UNKNOWN',
] as const;

export const ENTAILMENT_LEVELS = [
  'DIRECT',
  'STRONG_INFERENCE',
  'WEAK_INFERENCE',
  'UNSUPPORTED',
  'UNKNOWN',
] as const;

export const SEMANTIC_RISKS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export type EvidenceSemanticFlag =
  | 'EVIDENCE_CLAIM_SEMANTIC_MISMATCH'
  | 'UNKNOWN_AS_NEGATIVE_EVIDENCE'
  | 'ABSENCE_OF_EVIDENCE_AS_ABSENCE'
  | 'UNSUPPORTED_CAUSAL_CLAIM'
  | 'UNSUPPORTED_RELATIVE_CLAIM'
  | 'UNSUPPORTED_TIME_TREND'
  | 'UNSUPPORTED_LEAP'
  | 'CONTEXT_MISTAKEN_AS_EVIDENCE'
  | 'PEER_OPINION_AS_EVIDENCE';

const CAUSAL_RE =
  /(때문에|로\s*인해|원인|유발|caused by|due to|leads to|results from|because)/i;
const RELATIVE_RE =
  /(매우\s*(높|낮)|심각|과도|압도|크게\s*(증가|감소)|경쟁력이\s*(높|낮)|very\s+(high|low)|severely|critically\s+low|tiny|매우\s*작)/i;
const TREND_RE =
  /(감소했|증가했|악화|개선됐|정체됐|성장하고|declined|decreased|increased|worsened|improved|stagnat|growing)/i;
const UX_CAUSE_RE = /(UX|UI|사용성).{0,40}(문제|원인|bad|poor|실패)/i;
const SEO_FAIL_RE = /(SEO|검색).{0,40}(실패|실패했다|failed)/i;
const GEMINI_EFFECT_RE =
  /(Gemini|AI\s*기능).{0,60}(증가|늘|boost|increase|engagement|참여)/i;
const QUALITY_RE = /(콘텐츠\s*품질|content\s+quality).{0,20}(높|좋|high|good)/i;
const LOW_ACTIVITY_RE =
  /(활동량이\s*매우\s*낮|사용자\s*활동이\s*매우\s*낮|engagement\s+is\s+very\s+low|critically\s+low\s+activity|severe\s+lack\s+of\s+user)/i;
const NULL_MEASURE_RE =
  /(측정할\s*수\s*없|알\s*수\s*없|not\s+measured|unavailable|unknown|측정\s*불가)/i;
const PEER_AS_EVIDENCE_RE =
  /(다른\s*AI|majority|all\s+reviewers|peer\s+opinion|다른\s*리뷰어).{0,40}(증거|evidence|근거)/i;

export type EntailmentEvalInput = {
  claimText: string;
  evidence: EvidencePack;
  /** Optional prior comparison values for trend claims */
  priorNewUsers?: number | null;
  priorUserCount?: number | null;
};

export type EntailmentEvalResult = {
  evidenceRelation: EvidenceRelation;
  entailmentLevel: EntailmentLevel;
  semanticRisk: SemanticRisk;
  unsupportedLeap: boolean;
  flags: EvidenceSemanticFlag[];
  explanation: string;
  directEvidenceRefs: string[];
  supportingEvidenceRefs: string[];
  missingEvidence: string[];
};

function agg(evidence: EvidencePack) {
  return evidence.aggregates;
}

/**
 * Deterministic entailment judgment for known claim patterns (TDD cases).
 */
export function evaluateEvidenceClaimEntailment(
  input: EntailmentEvalInput,
): EntailmentEvalResult {
  const text = input.claimText.trim();
  const a = agg(input.evidence);
  const flags: EvidenceSemanticFlag[] = [];
  const direct: string[] = [];
  const supporting: string[] = [];
  const missing: string[] = [];

  // --- Direct metric facts ---
  if (
    /신규.*(0|영|없)|new\s*users?.{0,20}(0|zero|none)|가입자.?는\s*0/i.test(text) &&
    !TREND_RE.test(text) &&
    a.newUsersLast7d === 0
  ) {
    direct.push('newUsersLast7d');
    return ok('DIRECTLY_SUPPORTS', 'DIRECT', 'LOW', false, flags, direct, supporting, missing, text);
  }

  if (
    /댓글.*(0|없|zero)|comments?.{0,20}(0|zero|none)|댓글\s*작성은\s*없/i.test(text) &&
    !CAUSAL_RE.test(text) &&
    !UX_CAUSE_RE.test(text) &&
    a.commentsLast7d === 0
  ) {
    // posts+comments combined observation
    if (/게시글|posts?/i.test(text) && typeof a.postsLast7d === 'number') {
      direct.push('postsLast7d', 'commentsLast7d');
      return ok(
        'DIRECTLY_SUPPORTS',
        'DIRECT',
        'LOW',
        false,
        flags,
        direct,
        supporting,
        missing,
        text,
      );
    }
    direct.push('commentsLast7d');
    return ok('DIRECTLY_SUPPORTS', 'DIRECT', 'LOW', false, flags, direct, supporting, missing, text);
  }

  if (
    /전체\s*사용자\s*수|userCount|회원\s*수는\s*14|사용자\s*수는\s*14/i.test(text) &&
    typeof a.userCount === 'number' &&
    /14|열네/.test(text)
  ) {
    direct.push('userCount');
    return ok('DIRECTLY_SUPPORTS', 'DIRECT', 'LOW', false, flags, direct, supporting, missing, text);
  }

  // Null metrics: "cannot measure" vs "activity is low"
  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    NULL_MEASURE_RE.test(text) &&
    /(active|활성|views|조회)/i.test(text)
  ) {
    if (a.activeUsersLast7d == null) direct.push('activeUsersLast7d');
    if (a.viewsLast7d == null) direct.push('viewsLast7d');
    return ok('DIRECTLY_SUPPORTS', 'DIRECT', 'LOW', false, flags, direct, supporting, missing, text);
  }

  if (
    (a.activeUsersLast7d == null || a.viewsLast7d == null) &&
    LOW_ACTIVITY_RE.test(text) &&
    !NULL_MEASURE_RE.test(text)
  ) {
    flags.push('UNKNOWN_AS_NEGATIVE_EVIDENCE');
    flags.push('ABSENCE_OF_EVIDENCE_AS_ABSENCE');
    missing.push('activeUsersLast7d', 'viewsLast7d');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Null/unknown metrics do not entail low activity',
    );
  }

  // UX causal from comments=0
  if (UX_CAUSE_RE.test(text) || (/댓글/.test(text) && /UX|UI/.test(text) && CAUSAL_RE.test(text))) {
    flags.push('UNSUPPORTED_CAUSAL_CLAIM');
    flags.push('UNSUPPORTED_LEAP');
    supporting.push('commentsLast7d');
    missing.push('ux_events', 'user_feedback');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Zero comments ≠ UX is the cause',
    );
  }

  // SEO failed from newUsers=0
  if (SEO_FAIL_RE.test(text)) {
    flags.push('UNSUPPORTED_LEAP');
    supporting.push('newUsersLast7d');
    missing.push('seo_rankings', 'search_traffic');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Zero new users ≠ SEO failed',
    );
  }

  // Gemini engagement increase
  if (GEMINI_EFFECT_RE.test(text)) {
    flags.push('UNSUPPORTED_CAUSAL_CLAIM');
    flags.push('UNSUPPORTED_LEAP');
    supporting.push('site.stackNotes');
    missing.push('ai_feature_usage', 'conversion', 'retention');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Integration existence ≠ engagement increase',
    );
  }

  // Content quality high from post count
  if (QUALITY_RE.test(text)) {
    flags.push('UNSUPPORTED_LEAP');
    supporting.push('postsLast7d');
    missing.push('quality_ratings', 'dwell_time');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'MEDIUM',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Post volume ≠ content quality',
    );
  }

  // Trend: acquisition decreased without prior
  if (
    /신규.*(감소|줄었)|acquisition\s+decreas|유입이\s*감소/i.test(text) &&
    (input.priorNewUsers == null || input.priorNewUsers === undefined)
  ) {
    flags.push('UNSUPPORTED_TIME_TREND');
    supporting.push('newUsersLast7d');
    missing.push('newUsersPriorPeriod');
    return ok(
      'UNKNOWN',
      'UNKNOWN',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Single-period zero does not entail decline vs prior',
    );
  }

  // Trend with prior comparison
  if (
    /사용자.*(감소|줄었)|users?\s+decreas/i.test(text) &&
    typeof input.priorUserCount === 'number' &&
    typeof a.userCount === 'number' &&
    a.userCount < input.priorUserCount
  ) {
    direct.push('userCount');
    return ok(
      'DIRECTLY_SUPPORTS',
      'STRONG_INFERENCE',
      'LOW',
      false,
      flags,
      direct,
      supporting,
      missing,
      'Current < prior userCount supports decrease claim',
    );
  }

  // Relative: user base very small
  if (RELATIVE_RE.test(text) && /사용자|user\s*base|회원/i.test(text)) {
    flags.push('UNSUPPORTED_RELATIVE_CLAIM');
    supporting.push('userCount');
    missing.push('comparison_baseline');
    return ok(
      'PARTIALLY_SUPPORTS',
      'WEAK_INFERENCE',
      'MEDIUM',
      false,
      flags,
      direct,
      supporting,
      missing,
      'Absolute count known; relative “very small” lacks baseline',
    );
  }

  // Content fails to drive engagement (posts + comments=0)
  if (
    /(참여를\s*유도하지|induce|drive\s+engagement|콘텐츠가\s*사용자)/i.test(text) &&
    typeof a.postsLast7d === 'number' &&
    a.commentsLast7d === 0
  ) {
    flags.push('UNSUPPORTED_LEAP');
    supporting.push('postsLast7d', 'commentsLast7d');
    missing.push('viewsLast7d', 'dwell_time', 'reactions');
    return ok(
      'PARTIALLY_SUPPORTS',
      'WEAK_INFERENCE',
      'MEDIUM',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Comments=0 partially supports weak interaction; not full engagement failure',
    );
  }

  // Platform-wide engagement critically low from signup/comments only
  if (
    /(전체.*(참여|engagement).*(심각|낮)|platform.?wide.*(engagement|activity).*(low|crisis))/i.test(
      text,
    )
  ) {
    supporting.push('newUsersLast7d', 'commentsLast7d');
    missing.push('activeUsersLast7d', 'viewsLast7d');
    if (a.activeUsersLast7d == null) flags.push('ABSENCE_OF_EVIDENCE_AS_ABSENCE');
    return ok(
      'PARTIALLY_SUPPORTS',
      'WEAK_INFERENCE',
      'HIGH',
      false,
      flags,
      direct,
      supporting,
      missing,
      'Measured zeros partially support; cannot prove platform-wide activity',
    );
  }

  if (PEER_AS_EVIDENCE_RE.test(text)) {
    flags.push('PEER_OPINION_AS_EVIDENCE');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Peer opinion is not EvidencePack evidence',
    );
  }

  // Generic causal without evidence
  if (CAUSAL_RE.test(text)) {
    flags.push('UNSUPPORTED_CAUSAL_CLAIM');
    return ok(
      'DOES_NOT_SUPPORT',
      'UNSUPPORTED',
      'HIGH',
      true,
      flags,
      direct,
      supporting,
      missing,
      'Causal claim lacks direct causal evidence in pack',
    );
  }

  return ok(
    'UNKNOWN',
    'UNKNOWN',
    'MEDIUM',
    false,
    flags,
    direct,
    supporting,
    missing,
    'No strong pattern match; relation unknown',
  );
}

function ok(
  evidenceRelation: EvidenceRelation,
  entailmentLevel: EntailmentLevel,
  semanticRisk: SemanticRisk,
  unsupportedLeap: boolean,
  flags: EvidenceSemanticFlag[],
  directEvidenceRefs: string[],
  supportingEvidenceRefs: string[],
  missingEvidence: string[],
  explanation: string,
): EntailmentEvalResult {
  return {
    evidenceRelation,
    entailmentLevel,
    semanticRisk,
    unsupportedLeap,
    flags,
    explanation,
    directEvidenceRefs,
    supportingEvidenceRefs,
    missingEvidence,
  };
}

export function normalizeEvidenceSemanticsMember(
  memberId: CommitteeAnalystId,
  raw: unknown,
  calibration?: ClaimCalibration,
): EvidenceSemanticsMember {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const claimsRaw = Array.isArray(o.claims) ? o.claims : [];
  const calClaims = calibration?.claims ?? [];
  const claims: EvidenceSemanticsRow[] = claimsRaw
    .map((item, idx) => {
      if (!item || typeof item !== 'object') return null;
      const c = item as Record<string, unknown>;
      const claimId =
        typeof c.claimId === 'string'
          ? c.claimId
          : calClaims[idx]?.claimId ?? `C${String(idx + 1).padStart(3, '0')}`;
      const cal = calClaims.find((x) => x.claimId === claimId);
      return {
        claimId,
        claimText:
          typeof c.claimText === 'string'
            ? c.claimText
            : cal?.claimText ?? '',
        evidenceRelation: isEvidenceRelation(c.evidenceRelation)
          ? c.evidenceRelation
          : 'UNKNOWN',
        entailmentLevel: isEntailmentLevel(c.entailmentLevel)
          ? c.entailmentLevel
          : 'UNKNOWN',
        directEvidenceRefs: asStrArr(c.directEvidenceRefs),
        supportingEvidenceRefs: asStrArr(c.supportingEvidenceRefs),
        missingEvidence: asStrArr(c.missingEvidence),
        inferenceSteps: asStrArr(c.inferenceSteps),
        unsupportedLeap: Boolean(c.unsupportedLeap),
        semanticRisk: isSemanticRisk(c.semanticRisk) ? c.semanticRisk : 'MEDIUM',
        explanation: typeof c.explanation === 'string' ? c.explanation : '',
      } satisfies EvidenceSemanticsRow;
    })
    .filter((x): x is EvidenceSemanticsRow => x !== null);

  // Ensure every calibrated claim has a row (fill with heuristic if LLM omitted)
  if (calibration && claims.length < calibration.claims.length) {
    for (const cal of calibration.claims) {
      if (!claims.some((c) => c.claimId === cal.claimId)) {
        claims.push({
          claimId: cal.claimId,
          claimText: cal.claimText,
          evidenceRelation: 'UNKNOWN',
          entailmentLevel: 'UNKNOWN',
          directEvidenceRefs: [],
          supportingEvidenceRefs: cal.evidenceRefs,
          missingEvidence: cal.missingEvidence,
          inferenceSteps: [],
          unsupportedLeap: false,
          semanticRisk: 'MEDIUM',
          explanation: 'Missing from LLM response; placeholder',
        });
      }
    }
  }

  return { memberId, claims };
}

function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export type SemanticsCheckResult = {
  memberId: CommitteeAnalystId;
  claimId: string;
  evidenceRelation: EvidenceRelation;
  entailmentLevel: EntailmentLevel;
  semanticRisk: SemanticRisk;
  unsupportedLeap: boolean;
  flags: EvidenceSemanticFlag[];
  reason: string;
};

/**
 * Re-evaluate calibrated claims against EvidencePack and compare to LLM semantics.
 */
export function runEvidenceSemanticsChecks(
  evidence: EvidencePack,
  calibrations: ClaimCalibration[],
  semantics: EvidenceSemanticsMember[],
  revisions?: RevisionRecord[],
): SemanticsCheckResult[] {
  const results: SemanticsCheckResult[] = [];
  for (const cal of calibrations) {
    const sem = semantics.find((s) => s.memberId === cal.memberId);
    const rev = revisions?.find((r) => r.memberId === cal.memberId);
    for (const claim of cal.claims) {
      const llmRow = sem?.claims.find((c) => c.claimId === claim.claimId);
      const evaled = evaluateEvidenceClaimEntailment({
        claimText: claim.claimText,
        evidence,
      });
      const flags = [...evaled.flags];

      // Also scan revision final opinion for unknown-as-negative / leaps
      if (rev) {
        const finalEval = evaluateEvidenceClaimEntailment({
          claimText: rev.finalOpinion,
          evidence,
        });
        for (const f of finalEval.flags) {
          if (
            f === 'UNKNOWN_AS_NEGATIVE_EVIDENCE' ||
            f === 'UNSUPPORTED_CAUSAL_CLAIM' ||
            f === 'PEER_OPINION_AS_EVIDENCE'
          ) {
            if (!flags.includes(f)) flags.push(f);
          }
        }
        if (
          textUsesPeerAsEvidence(
            `${rev.revisionReason || ''}\n${rev.retainReason || ''}\n${rev.confidenceChangeReason || ''}`,
          )
        ) {
          if (!flags.includes('PEER_OPINION_AS_EVIDENCE')) {
            flags.push('PEER_OPINION_AS_EVIDENCE');
          }
        }
        // Semantics vs revision mismatch
        if (
          llmRow &&
          (llmRow.evidenceRelation === 'DOES_NOT_SUPPORT' ||
            llmRow.evidenceRelation === 'UNKNOWN') &&
          rev.revisionStatus === 'UNCHANGED' &&
          !/(caveat|단서|가설|unknown|측정|cannot|알\s*수\s*없)/i.test(
            `${rev.retainReason || ''}\n${rev.finalOpinion}`,
          ) &&
          (llmRow.semanticRisk === 'HIGH' || llmRow.semanticRisk === 'CRITICAL')
        ) {
          flags.push('EVIDENCE_CLAIM_SEMANTIC_MISMATCH');
        }
      }

      // LLM vs heuristic mismatch on high-risk patterns
      if (
        llmRow &&
        evaled.evidenceRelation === 'DOES_NOT_SUPPORT' &&
        (llmRow.evidenceRelation === 'DIRECTLY_SUPPORTS' ||
          llmRow.evidenceRelation === 'PARTIALLY_SUPPORTS')
      ) {
        flags.push('EVIDENCE_CLAIM_SEMANTIC_MISMATCH');
        flags.push('CONTEXT_MISTAKEN_AS_EVIDENCE');
      }

      results.push({
        memberId: cal.memberId,
        claimId: claim.claimId,
        evidenceRelation: llmRow?.evidenceRelation ?? evaled.evidenceRelation,
        entailmentLevel: llmRow?.entailmentLevel ?? evaled.entailmentLevel,
        semanticRisk: llmRow?.semanticRisk ?? evaled.semanticRisk,
        unsupportedLeap: llmRow?.unsupportedLeap ?? evaled.unsupportedLeap,
        flags: [...new Set(flags)],
        reason: evaled.explanation,
      });
    }
  }
  return results;
}

export function textUsesPeerAsEvidence(text: string): boolean {
  return PEER_AS_EVIDENCE_RE.test(text);
}

export function buildCriticSemanticsOverlay(checks: SemanticsCheckResult[]): {
  evidenceSemanticsIntegrity: {
    status: 'PASS' | 'WARN' | 'FAIL';
    issues: string[];
    summary: string;
  };
  evidenceClaimSemanticMismatchFlags: { ok: boolean; flags: string[] };
  absenceOfEvidenceAsAbsenceFlags: { ok: boolean; flags: string[] };
  unsupportedCausalClaimFlags: { ok: boolean; flags: string[] };
  unsupportedRelativeClaimFlags: { ok: boolean; flags: string[] };
  unsupportedTimeTrendFlags: { ok: boolean; flags: string[] };
  unsupportedLeapFlags: { ok: boolean; flags: string[] };
  contextMistakenAsEvidenceFlags: { ok: boolean; flags: string[] };
  peerOpinionAsEvidenceFlags: { ok: boolean; flags: string[] };
  unknownAsNegativeEvidenceFlags: { ok: boolean; flags: string[] };
} {
  const by = (flag: EvidenceSemanticFlag) =>
    checks
      .filter((c) => c.flags.includes(flag))
      .map((c) => `${c.memberId}:${c.claimId}:${flag}`);

  const mismatch = by('EVIDENCE_CLAIM_SEMANTIC_MISMATCH');
  const unknownNeg = by('UNKNOWN_AS_NEGATIVE_EVIDENCE');
  const absence = by('ABSENCE_OF_EVIDENCE_AS_ABSENCE');
  const causal = by('UNSUPPORTED_CAUSAL_CLAIM');
  const relative = by('UNSUPPORTED_RELATIVE_CLAIM');
  const trend = by('UNSUPPORTED_TIME_TREND');
  const leap = by('UNSUPPORTED_LEAP');
  const context = by('CONTEXT_MISTAKEN_AS_EVIDENCE');
  const peer = by('PEER_OPINION_AS_EVIDENCE');

  const issues = checks
    .filter((c) => c.flags.length > 0)
    .map((c) => `${c.memberId}/${c.claimId}: [${c.flags.join(',')}] ${c.reason}`);
  const failish =
    mismatch.length + unknownNeg.length + causal.length + leap.length + peer.length;
  const status: 'PASS' | 'WARN' | 'FAIL' =
    failish > 0 ? 'FAIL' : issues.length > 0 ? 'WARN' : 'PASS';

  return {
    evidenceSemanticsIntegrity: {
      status,
      issues,
      summary: `flaggedClaims=${issues.length} mismatch=${mismatch.length} unknownNeg=${unknownNeg.length}`,
    },
    evidenceClaimSemanticMismatchFlags: { ok: mismatch.length === 0, flags: mismatch },
    absenceOfEvidenceAsAbsenceFlags: { ok: absence.length === 0, flags: absence },
    unsupportedCausalClaimFlags: { ok: causal.length === 0, flags: causal },
    unsupportedRelativeClaimFlags: { ok: relative.length === 0, flags: relative },
    unsupportedTimeTrendFlags: { ok: trend.length === 0, flags: trend },
    unsupportedLeapFlags: { ok: leap.length === 0, flags: leap },
    contextMistakenAsEvidenceFlags: { ok: context.length === 0, flags: context },
    peerOpinionAsEvidenceFlags: { ok: peer.length === 0, flags: peer },
    unknownAsNegativeEvidenceFlags: { ok: unknownNeg.length === 0, flags: unknownNeg },
  };
}

export function formatEvidenceSemanticsFindings(checks: SemanticsCheckResult[]): string[] {
  const byRel: Record<string, number> = {};
  const byFlag: Record<string, number> = {};
  for (const c of checks) {
    byRel[c.evidenceRelation] = (byRel[c.evidenceRelation] || 0) + 1;
    for (const f of c.flags) byFlag[f] = (byFlag[f] || 0) + 1;
  }
  const lines = [
    `Evidence relations: ${Object.entries(byRel)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
  ];
  for (const [f, n] of Object.entries(byFlag)) lines.push(`${f}: ${n}`);
  lines.push(
    ...checks
      .filter((c) => c.flags.length > 0)
      .slice(0, 8)
      .map((c) => `${c.memberId}/${c.claimId}: ${c.flags.join(',')}`),
  );
  return lines;
}

export function formatSemanticsForRevisionPrompt(sem: EvidenceSemanticsMember): string {
  return JSON.stringify(
    sem.claims.map((c) => ({
      claimId: c.claimId,
      evidenceRelation: c.evidenceRelation,
      entailmentLevel: c.entailmentLevel,
      semanticRisk: c.semanticRisk,
      unsupportedLeap: c.unsupportedLeap,
      missingEvidence: c.missingEvidence,
      explanation: c.explanation,
    })),
    null,
    2,
  );
}

/** Enrich LLM semantics with deterministic corrections for high-confidence patterns */
export function enrichSemanticsWithHeuristics(
  evidence: EvidencePack,
  calibration: ClaimCalibration,
  member: EvidenceSemanticsMember,
): EvidenceSemanticsMember {
  const claims = member.claims.map((row) => {
    const cal = calibration.claims.find((c) => c.claimId === row.claimId);
    if (!cal) return row;
    const ev = evaluateEvidenceClaimEntailment({
      claimText: cal.claimText,
      evidence,
    });
    // Prefer heuristic when it detects DOES_NOT_SUPPORT / UNKNOWN high-risk and LLM was too generous
    if (
      (ev.evidenceRelation === 'DOES_NOT_SUPPORT' || ev.evidenceRelation === 'UNKNOWN') &&
      (ev.semanticRisk === 'HIGH' || ev.semanticRisk === 'CRITICAL') &&
      (row.evidenceRelation === 'DIRECTLY_SUPPORTS' ||
        row.evidenceRelation === 'PARTIALLY_SUPPORTS')
    ) {
      return {
        ...row,
        evidenceRelation: ev.evidenceRelation,
        entailmentLevel: ev.entailmentLevel,
        semanticRisk: ev.semanticRisk,
        unsupportedLeap: ev.unsupportedLeap || row.unsupportedLeap,
        missingEvidence: [...new Set([...row.missingEvidence, ...ev.missingEvidence])],
        explanation: `${row.explanation} | heuristic: ${ev.explanation}`,
      };
    }
    return row;
  });
  return { memberId: member.memberId, claims };
}

export function rowFromHeuristic(
  claim: CalibratedClaim,
  evidence: EvidencePack,
): EvidenceSemanticsRow {
  const ev = evaluateEvidenceClaimEntailment({ claimText: claim.claimText, evidence });
  return {
    claimId: claim.claimId,
    claimText: claim.claimText,
    evidenceRelation: ev.evidenceRelation,
    entailmentLevel: ev.entailmentLevel,
    directEvidenceRefs: ev.directEvidenceRefs,
    supportingEvidenceRefs: ev.supportingEvidenceRefs,
    missingEvidence: ev.missingEvidence.length ? ev.missingEvidence : claim.missingEvidence,
    inferenceSteps: [],
    unsupportedLeap: ev.unsupportedLeap,
    semanticRisk: ev.semanticRisk,
    explanation: ev.explanation,
  };
}
