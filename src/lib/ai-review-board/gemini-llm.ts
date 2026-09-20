import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  readGeminiApiKeyFromEnv,
} from '@/lib/gemini-prompt-analysis-engine';
import {
  GEMINI_REVIEW_BOARD_API_VERSION_CHAIN,
  GEMINI_REVIEW_BOARD_MODEL_CHAIN,
} from '@/lib/gemini-models';
import { ANTI_HERDING_DEBATE_RULES, CLAIM_CALIBRATION_RULES, EVIDENCE_SEMANTICS_RULES, MEMBER_FOCUS, PERSONA_SYSTEM, REVISION_QUALITY_RULES, REVISION_Q_CHECKLIST, SEMANTIC_JUDGE_RULES } from './personas';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import { SCORE_DIMENSIONS } from './score-dimensions';
import { listScoresLackingHardEvidence, normalizeDimensionScores } from './scoring';
import { assertIndependentContext } from './independence';
import {
  formatCalibrationForRevisionPrompt,
  listClaimFlags,
  normalizeClaimCalibration,
} from './claim-calibration';
import { listRevisionIntegrityIssues, normalizeRevisionRecord } from './revision-quality';
import {
  enrichSemanticsWithHeuristics,
  formatSemanticsForRevisionPrompt,
  normalizeEvidenceSemanticsMember,
} from './evidence-claim-entailment';
import { normalizeSemanticJudgments, summarizeSemanticJudgments } from './semantic-judge';
import type { ReviewBoardLlm } from './llm';
import type {
  CommitteeAnalystId,
  CriticCheck,
  CriticReport,
  DebateTurn,
  DimensionScore,
  EvidenceItem,
  EvidenceKind,
  EvidencePack,
  EvidenceSemanticsMember,
  FinalReport,
  IndependentAnalysis,
  ImprovementItem,
  LlmContext,
  RevisionRecord,
  RevisionSummaryBlock,
  SemanticJudgment,
  ClaimCalibration,
} from './types';

function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // truncated JSON: close open braces/brackets heuristically
        let slice = trimmed.slice(start);
        slice = slice.replace(/,\s*$/, '');
        const opens = (slice.match(/{/g) || []).length - (slice.match(/}/g) || []).length;
        const openArr = (slice.match(/\[/g) || []).length - (slice.match(/]/g) || []).length;
        slice += ']'.repeat(Math.max(0, openArr)) + '}'.repeat(Math.max(0, opens));
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

async function geminiJson(
  apiKey: string,
  system: string,
  user: string,
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  let lastErr: unknown;
  for (const modelId of GEMINI_REVIEW_BOARD_MODEL_CHAIN) {
    for (const apiVersion of GEMINI_REVIEW_BOARD_API_VERSION_CHAIN) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
          {
            model: modelId,
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json',
              maxOutputTokens: 16384,
            },
            systemInstruction: system,
          },
          { apiVersion },
        );
        const result = await model.generateContent(user);
        const text = result.response.text();
        const parsed = tryParseJson(text);
        if (parsed) return { ok: true, parsed };
        lastErr = new Error(
          `Non-JSON response from ${modelId}/${apiVersion} (len=${text.length})`,
        );
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (
          classified.category === 'RATE_LIMIT' ||
          classified.category === 'SERVER' ||
          classified.category === 'AUTH'
        ) {
          return { ok: false, error: classified.userMessage };
        }
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, error: msg || 'Gemini JSON failed' };
}

function compactIndependent(rows: IndependentAnalysis[]) {
  return rows.map((r) => ({
    memberId: r.memberId,
    currentState: r.currentState,
    strengths: r.strengths.slice(0, 5),
    problems: r.problems.slice(0, 8),
    improvements: r.improvements.slice(0, 5).map((i) => ({
      id: i.id,
      title: i.title,
      priority: i.priority,
    })),
    confidence: r.confidence,
    scores: r.scores.map((d) => ({
      dimension: d.dimension,
      score: d.score,
    })),
  }));
}

function compactJudgments(rows: SemanticJudgment[]) {
  return rows.map((j) => ({
    memberId: j.memberId,
    claimId: j.claimId,
    claimText: j.claimText.slice(0, 160),
    classification: j.judgeClassification,
    leap: j.semanticLeap.detected ? j.semanticLeap.type : 'NONE',
    action: j.recommendedAction,
    calibrationAgreement: j.calibrationAgreement,
    verdict: j.verdict,
  }));
}

function compactRevisions(rows: RevisionRecord[]) {
  return rows.map((r) => ({
    memberId: r.memberId,
    revisionStatus: r.revisionStatus,
    confidenceBefore: r.confidenceBefore,
    confidenceAfter: r.confidenceAfter,
    changedClaims: r.changedClaims.slice(0, 8),
    revisionReason: (r.revisionReason ?? '').slice(0, 160),
    retainReason: (r.retainReason ?? '').slice(0, 160),
    affectedClaims: (r.calibrationImpactAssessment?.affectedClaims ?? [])
      .slice(0, 8)
      .map((c) => ({
        claimId: c.claimId,
        action: c.revisionAction,
        reason: c.actionReason.slice(0, 120),
      })),
  }));
}

function compactSemantics(rows: EvidenceSemanticsMember[]) {
  return rows.map((s) => ({
    memberId: s.memberId,
    claims: s.claims.slice(0, 12).map((c) => ({
      claimId: c.claimId,
      claimText: c.claimText.slice(0, 120),
      evidenceRelation: c.evidenceRelation,
      entailmentLevel: c.entailmentLevel,
      unsupportedLeap: c.unsupportedLeap,
    })),
  }));
}

function compactCalibrations(rows: ClaimCalibration[]) {
  return rows.map((c) => ({
    memberId: c.memberId,
    claims: c.claims.slice(0, 12).map((row) => ({
      claimId: row.claimId,
      claimText: row.claimText.slice(0, 120),
      supportLevel: row.supportLevel,
      evidenceImpact: row.evidenceImpact,
      riskOfOverclaiming: row.riskOfOverclaiming,
    })),
  }));
}


function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseImprovements(raw: unknown): ImprovementItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, idx) => {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const difficulty = o.difficulty === 'low' || o.difficulty === 'high' ? o.difficulty : 'medium';
    const risk = o.risk === 'low' || o.risk === 'high' ? o.risk : 'medium';
    return {
      id: asString(o.id, `imp-${idx + 1}`),
      title: asString(o.title, 'Untitled'),
      priority: typeof o.priority === 'number' ? o.priority : idx + 1,
      expectedEffect: asString(o.expectedEffect),
      difficulty,
      risk,
      rationale: asString(o.rationale),
    };
  });
}

function parseScores(raw: unknown): DimensionScore[] {
  if (!Array.isArray(raw)) {
    return SCORE_DIMENSIONS.map((dimension) => ({
      dimension,
      score: null,
      evidence: [],
    }));
  }
  const byDim = new Map<string, DimensionScore>();
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const dimension = asString(o.dimension);
    if (!SCORE_DIMENSIONS.includes(dimension as DimensionScore['dimension'])) continue;
    const evidenceRaw = Array.isArray(o.evidence) ? o.evidence : [];
    const evidence: EvidenceItem[] = evidenceRaw.map((e) => {
      const eo = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      const kind: EvidenceKind =
        eo.kind === 'metric' ||
        eo.kind === 'doc' ||
        eo.kind === 'external_ref' ||
        eo.kind === 'inference'
          ? eo.kind
          : 'observation';
      return { kind, text: asString(eo.text), source: asString(eo.source) || undefined };
    });
    byDim.set(dimension, {
      dimension: dimension as DimensionScore['dimension'],
      score: typeof o.score === 'number' ? o.score : null,
      evidence,
    });
  }
  return SCORE_DIMENSIONS.map(
    (dimension) => byDim.get(dimension) ?? { dimension, score: null, evidence: [] },
  );
}

function evidenceBlock(evidence: EvidencePack): string {
  return formatEvidencePackForPrompt(evidence);
}

export function createGeminiReviewBoardLlm(apiKey?: string): ReviewBoardLlm {
  const keyRes = apiKey
    ? ({ ok: true as const, key: apiKey })
    : readGeminiApiKeyFromEnv();
  if (!keyRes.ok) {
    throw new Error('MISSING_GEMINI_KEY');
  }
  const key = keyRes.key;

  return {
    async independentAnalysis(memberId, evidence, ctx: LlmContext) {
      assertIndependentContext(ctx);
      const system = PERSONA_SYSTEM[memberId];
      const user = `EvidencePack (read-only, no PII):\n${evidenceBlock(evidence)}

Focus dimensions: ${MEMBER_FOCUS[memberId]}

Return JSON:
{
  "currentState": string,
  "strengths": string[],
  "problems": string[],
  "trendGap": string,
  "improvementNeed": string,
  "improvements": [{ "id","title","priority","expectedEffect","difficulty","risk","rationale" }],
  "scores": [{ "dimension": one of ${SCORE_DIMENSIONS.join('|')}, "score": number|null, "evidence": [{ "kind","text","source?" }] }],
  "judgmentBasis": string,
  "confidence": number 0-1,
  "originalOpinion": string
}`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      const originalOpinion = asString(o.originalOpinion, asString(o.currentState, `${memberId} analysis`));
      const analysis: IndependentAnalysis = {
        memberId,
        currentState: asString(o.currentState),
        strengths: asStringArray(o.strengths),
        problems: asStringArray(o.problems),
        trendGap: asString(o.trendGap),
        improvementNeed: asString(o.improvementNeed),
        improvements: parseImprovements(o.improvements),
        scores: normalizeDimensionScores(parseScores(o.scores)),
        judgmentBasis: asString(o.judgmentBasis),
        confidence: typeof o.confidence === 'number' ? Math.min(1, Math.max(0, o.confidence)) : 0.5,
        originalOpinion,
      };
      return analysis;
    },

    async debateTurn(memberId, evidence, peers, own) {
      const system = `${PERSONA_SYSTEM[memberId]}\n${ANTI_HERDING_DEBATE_RULES}`;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Your original independent analysis (immutable originalOpinion):
${JSON.stringify(own, null, 2)}

Peer independent analyses (now visible — for rebuttal mining only):
${JSON.stringify(peers.filter((p) => p.memberId !== memberId), null, 2)}

Return JSON ONLY (no revisionStatus — revision is a later phase):
{
  "agreement": string[],
  "disagreement": string[],
  "weakEvidence": string[],
  "missed": string[],
  "needsVerification": string[]
}`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      const turn: DebateTurn = {
        memberId,
        agreement: asStringArray(o.agreement),
        disagreement: asStringArray(o.disagreement),
        weakEvidence: asStringArray(o.weakEvidence),
        missed: asStringArray(o.missed),
        needsVerification: asStringArray(o.needsVerification),
      };
      return turn;
    },

    async claimCalibrate(memberId, evidence, own, ownDebate) {
      const system = `${PERSONA_SYSTEM[memberId]}\n${CLAIM_CALIBRATION_RULES}`;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Your independent analysis:
${JSON.stringify(own, null, 2)}

Your debate turn (for candidate claims / gaps only — NOT evidence for supportLevel):
${JSON.stringify(ownDebate, null, 2)}

Return JSON:
{
  "memberId": "${memberId}",
  "claims": [
    {
      "claimId": "C001",
      "claimText": string,
      "evidenceRefs": string[],
      "evidenceType": "DIRECT_FACT" | "CROSS_SOURCE_DIVERGENCE" | "INFERENCE" | "HYPOTHESIS" | "UNKNOWN",
      "supportLevel": "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED",
      "reason": string,
      "missingEvidence": string[],
      "evidenceImpact": "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "riskOfOverclaiming": "LOW" | "MEDIUM" | "HIGH",
      "reasoningLevel": "FACT" | "OBSERVATION" | "POSSIBLE_EXPLANATION" | "HYPOTHESIS" | "VERIFICATION" (optional)
    }
  ]
}

Extract 3–7 claims. Final supportLevel/evidenceType/evidenceImpact must be grounded in EvidencePack only.
GA≠DB → prefer CROSS_SOURCE_DIVERGENCE + reasoningLevel OBSERVATION; never auto-claim tracking failure.`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      return normalizeClaimCalibration(memberId, res.parsed);
    },

    async evidenceSemanticsPass(memberId, evidence, calibration) {
      const system = `${PERSONA_SYSTEM[memberId]}\n${EVIDENCE_SEMANTICS_RULES}`;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Claim Calibration (judge each claimId — do not invent new claimIds):
${JSON.stringify(calibration, null, 2)}

Return JSON:
{
  "memberId": "${memberId}",
  "claims": [
    {
      "claimId": "C001",
      "claimText": string,
      "evidenceRelation": "DIRECTLY_SUPPORTS" | "PARTIALLY_SUPPORTS" | "CONTEXT_ONLY" | "DOES_NOT_SUPPORT" | "CONTRADICTS" | "UNKNOWN",
      "entailmentLevel": "DIRECT" | "STRONG_INFERENCE" | "WEAK_INFERENCE" | "UNSUPPORTED" | "UNKNOWN",
      "directEvidenceRefs": string[],
      "supportingEvidenceRefs": string[],
      "missingEvidence": string[],
      "inferenceSteps": string[],
      "unsupportedLeap": boolean,
      "semanticRisk": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "explanation": string
    }
  ]
}

UNKNOWN/null metrics are NOT negative evidence. No numeric entailment scores.`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const normalized = normalizeEvidenceSemanticsMember(memberId, res.parsed, calibration);
      return enrichSemanticsWithHeuristics(evidence, calibration, normalized);
    },

    async semanticJudgePass(memberId, evidence, own, ownDebate, calibration, evidenceSemantics) {
      const system = `${PERSONA_SYSTEM.F}\n${SEMANTIC_JUDGE_RULES}`;
      const user = `You are an independent Semantic Judge for member ${memberId}.
Do NOT follow peer majority. Judge only EvidencePack ↔ claim wording.

EvidencePack:
${evidenceBlock(evidence)}

Member independent (context only):
${JSON.stringify({ memberId: own.memberId, originalOpinion: own.originalOpinion }, null, 2)}

Debate (counterargument discovery only — NOT evidence):
${JSON.stringify(ownDebate, null, 2)}

Claim Calibration:
${JSON.stringify(calibration, null, 2)}

Evidence Semantics:
${JSON.stringify(evidenceSemantics, null, 2)}

Return JSON:
{
  "memberId": "${memberId}",
  "judgments": [
    {
      "claimId": "C001",
      "judgeClassification": {
        "evidenceType": "DIRECT_FACT" | "CROSS_SOURCE_DIVERGENCE" | "INFERENCE" | "HYPOTHESIS" | "UNKNOWN",
        "supportLevel": "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED",
        "evidenceRelation": "DIRECTLY_SUPPORTS" | "PARTIALLY_SUPPORTS" | "DOES_NOT_SUPPORT" | "UNKNOWN" | "CONTEXT_ONLY" | "CONTRADICTS",
        "overclaimRisk": "LOW" | "MEDIUM" | "HIGH"
      },
      "judgeReason": string,
      "missingEvidence": string[],
      "semanticLeap": {
        "detected": boolean,
        "type": "UNKNOWN_AS_NEGATIVE_EVIDENCE" | "FACT_TO_CAUSALITY" | "FACT_TO_TREND" | "FACT_TO_GLOBAL_CONCLUSION" | "TECH_STACK_TO_QUALITY" | "DIVERGENCE_AS_CAUSALITY" | "DEVICE_RATIO_TO_UX" | "ENGAGEMENT_WITHOUT_BENCHMARK" | "TECH_STACK_TO_COMPETITIVE_ADVANTAGE" | "MAJORITY_AS_EVIDENCE" | "HYPOTHESIS_PRESENTED_AS_FACT" | "NONE"
      },
      "confidence": number,
      "recommendedAction": "NO_CHANGE" | "REWORD" | "NARROW" | "DOWNGRADE_SUPPORT" | "DOWNGRADE_CONFIDENCE" | "ADD_CAVEAT" | "REQUEST_MORE_EVIDENCE"
    }
  ]
}

Do NOT invent TP/FP/TN/FN. Leave verdict unset. null ≠ 0. UNKNOWN ≠ low activity.
GA≠DB divergence ≠ tracking failure. Device counts ≠ UX. Stack ≠ competitive advantage.`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      return normalizeSemanticJudgments(
        memberId,
        res.parsed,
        calibration,
        evidenceSemantics,
        evidence,
        true,
      );
    },

    async revisionPass(
      memberId,
      evidence,
      own,
      ownDebate,
      peers,
      calibration,
      evidenceSemantics,
      semanticJudgments,
    ) {
      const system = `${PERSONA_SYSTEM[memberId]}\n${REVISION_QUALITY_RULES}\n${REVISION_Q_CHECKLIST}`;
      const calBlock = calibration
        ? formatCalibrationForRevisionPrompt(calibration)
        : '(no claim calibration provided)';
      const semBlock = evidenceSemantics
        ? formatSemanticsForRevisionPrompt(evidenceSemantics)
        : '(no evidence semantics provided)';
      const judgeBlock = semanticJudgments?.length
        ? JSON.stringify(
            semanticJudgments.map((j) => ({
              claimId: j.claimId,
              judgeClassification: j.judgeClassification,
              semanticLeap: j.semanticLeap,
              recommendedAction: j.recommendedAction,
              judgeReason: j.judgeReason,
              calibrationAgreement: j.calibrationAgreement,
            })),
            null,
            2,
          )
        : '(no semantic judge provided)';
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Your independent analysis (originalOpinion is immutable history):
${JSON.stringify(own, null, 2)}

Your debate turn (rebuttals / gaps):
${JSON.stringify(ownDebate, null, 2)}

Claim Calibration (use as input; do NOT force PARTIAL/FULL):
${calBlock}

Evidence Semantics:
${semBlock}

Semantic Judge (v8 — independent adjudication; review carefully; do NOT force revision):
${judgeBlock}

Peer independent analyses (arguments only — do NOT use majority agreement as retain/revision/confidence ground):
${JSON.stringify(peers.filter((p) => p.memberId !== memberId), null, 2)}

Do NOT choose PARTIAL/FULL just to satisfy the experiment. If UNCHANGED after Judge HIGH overclaim / leap, retainReason MUST cite the claimId and why you keep wording.
If a claim is DOES_NOT_SUPPORT/UNKNOWN with HIGH semanticRisk, do not keep strong factual wording without caveat.

Return JSON:
{
  "revisionStatus": "UNCHANGED" | "PARTIAL" | "FULL",
  "revised": boolean,
  "revisionReason": string|null,
  "retainReason": string|null,
  "changedClaims": string[],
  "newEvidenceAccepted": string[],
  "rejectedArguments": [{"argument": string, "reason": string}],
  "confidenceBefore": number,
  "confidenceAfter": number,
  "confidenceChangeReason": string,
  "finalOpinion": string,
  "calibrationImpactAssessment": {
    "materiallyAffected": boolean,
    "affectedClaims": [
      {
        "claimId": "C001",
        "calibrationSupportLevel": "SUPPORTED" | "PARTIALLY_SUPPORTED" | "NOT_SUPPORTED",
        "calibrationEvidenceImpact": "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
        "calibrationRiskOfOverclaiming": "LOW" | "MEDIUM" | "HIGH",
        "revisionAction": "REWORD" | "NARROW" | "DOWNGRADE_CONFIDENCE" | "ADD_CAVEAT" | "RETAIN_WITH_JUSTIFICATION" | "NO_ACTION_NEEDED",
        "actionReason": string
      }
    ]
  },
  "revisionAnswers": {
    "q1_coreClaim": string,
    "q2_strongestRebuttal": string,
    "q3_rebuttalEvidenceKind": string,
    "q4_evidenceGapsFound": string,
    "q5_gapAffectsCoreClaim": string,
    "q6_directlySupportedScope": string,
    "q7_overclaimCheck": string,
    "q8_whyRetainIfUnchanged": string,
    "q9_claimsToChangeIfPartial": string,
    "q10_groundsForFullRevision": string,
    "q11_chosenStatus": "UNCHANGED" | "PARTIAL" | "FULL",
    "q12_confidenceChange": string
  }
}`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      return normalizeRevisionRecord({
        memberId,
        originalOpinion: own.originalOpinion,
        confidenceBefore:
          typeof o.confidenceBefore === 'number' ? o.confidenceBefore : own.confidence,
        revisionStatus: o.revisionStatus,
        revised: o.revised,
        revisionReason: o.revisionReason,
        retainReason: o.retainReason,
        changedClaims: o.changedClaims,
        newEvidenceAccepted: o.newEvidenceAccepted,
        rejectedArguments: o.rejectedArguments,
        confidenceAfter: o.confidenceAfter,
        confidenceChangeReason: o.confidenceChangeReason,
        finalOpinion: o.finalOpinion,
        revisionAnswers: o.revisionAnswers,
        calibrationImpactAssessment: o.calibrationImpactAssessment,
      });
    },

    async critic(
      evidence,
      independent,
      debate,
      revisions,
      claimCalibrations,
      evidenceSemantics,
      semanticJudgments,
    ): Promise<CriticReport> {
      const lacking = independent.flatMap((i) =>
        listScoresLackingHardEvidence(i.scores).map((d) => `${i.memberId}:${d}`),
      );
      const revs = revisions ?? [];
      const cals = claimCalibrations ?? [];
      const sems = evidenceSemantics ?? [];
      const judgments = semanticJudgments ?? [];
      const preFlags = revs.flatMap((r) =>
        listRevisionIntegrityIssues(r).map((i) => `${r.memberId}:${i}`),
      );
      const claimFlags = cals.flatMap((cal) =>
        cal.claims.flatMap((c) =>
          listClaimFlags(c, evidence).map((f) => `${cal.memberId}:${c.claimId}:${f}`),
        ),
      );
      const system = PERSONA_SYSTEM.F;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Independent:\n${JSON.stringify(independent, null, 2)}
Debate:\n${JSON.stringify(debate, null, 2)}
ClaimCalibrations:\n${JSON.stringify(cals, null, 2)}
EvidenceSemantics:\n${JSON.stringify(sems, null, 2)}
SemanticJudgments:\n${JSON.stringify(judgments, null, 2)}
Revisions:\n${JSON.stringify(revs, null, 2)}

Precomputed scoresWithoutEvidence: ${JSON.stringify(lacking)}
Precomputed revision integrity flags: ${JSON.stringify(preFlags)}
Precomputed claim flags: ${JSON.stringify(claimFlags)}

Return JSON with boolean fields plus CriticCheck objects {ok, flags[]} for:
revisionIntegrity, evidenceGrounding, overclaiming, herding, confidenceIntegrity, fabrication, statusConsistency,
claimCalibrationIntegrity, evidenceMappingIntegrity, unsupportedClaimFlags, overclaimingFlags,
unknownAsEvidenceFlags, causalClaimWithoutEvidenceFlags, confidenceCalibrationFlags, herdingFlags,
plus notes[], confidence, herdingDetected, factVsSpeculationOk, evidenceSufficient, scoresWithoutEvidence,
dominantMemberInfluence, trendEvidenceOk, userBenefitLikely, existingFeatureRisk, overEngineering.
Also check Judge: null≠0; no unsupported causal/trend/tech leaps; peer≠evidence; Judge not over-downgrading clear DIRECT facts.`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      const parseCheck = (v: unknown, fallbackFlags: string[] = []): CriticCheck => {
        if (v && typeof v === 'object') {
          const c = v as Record<string, unknown>;
          return {
            ok: Boolean(c.ok),
            flags: asStringArray(c.flags).length ? asStringArray(c.flags) : fallbackFlags,
          };
        }
        return { ok: fallbackFlags.length === 0, flags: fallbackFlags };
      };
      const unknownFlags = claimFlags.filter((f) => f.includes('unknown_as_evidence'));
      const causalFlags = claimFlags.filter((f) => f.includes('causal_without_evidence'));
      const overclaimFlags = claimFlags.filter((f) => f.includes('overclaim_risk'));
      return {
        factVsSpeculationOk: Boolean(o.factVsSpeculationOk),
        evidenceSufficient: Boolean(o.evidenceSufficient),
        scoresWithoutEvidence: asStringArray(o.scoresWithoutEvidence).length
          ? asStringArray(o.scoresWithoutEvidence)
          : lacking,
        herdingDetected: Boolean(o.herdingDetected),
        dominantMemberInfluence:
          typeof o.dominantMemberInfluence === 'string' ? o.dominantMemberInfluence : null,
        trendEvidenceOk: Boolean(o.trendEvidenceOk),
        userBenefitLikely: Boolean(o.userBenefitLikely),
        existingFeatureRisk: Boolean(o.existingFeatureRisk),
        overEngineering: Boolean(o.overEngineering),
        notes: asStringArray(o.notes),
        confidence: typeof o.confidence === 'number' ? o.confidence : 0.5,
        revisionIntegrity: parseCheck(o.revisionIntegrity, preFlags),
        evidenceGrounding: parseCheck(o.evidenceGrounding),
        overclaiming: parseCheck(o.overclaiming, overclaimFlags),
        herding: parseCheck(o.herding),
        confidenceIntegrity: parseCheck(o.confidenceIntegrity),
        fabrication: parseCheck(o.fabrication),
        statusConsistency: parseCheck(o.statusConsistency),
        claimCalibrationIntegrity: parseCheck(o.claimCalibrationIntegrity),
        evidenceMappingIntegrity: parseCheck(o.evidenceMappingIntegrity),
        unsupportedClaimFlags: parseCheck(o.unsupportedClaimFlags),
        overclaimingFlags: parseCheck(o.overclaimingFlags, overclaimFlags),
        unknownAsEvidenceFlags: parseCheck(o.unknownAsEvidenceFlags, unknownFlags),
        causalClaimWithoutEvidenceFlags: parseCheck(
          o.causalClaimWithoutEvidenceFlags,
          causalFlags,
        ),
        confidenceCalibrationFlags: parseCheck(o.confidenceCalibrationFlags),
        herdingFlags: parseCheck(o.herdingFlags),
      };
    },

    async chairman(
      evidence,
      independent,
      debate,
      critic,
      revisions,
      claimCalibrations,
      evidenceSemantics,
      semanticJudgments,
    ): Promise<FinalReport> {
      const revs = revisions ?? [];
      const cals = claimCalibrations ?? [];
      const sems = evidenceSemantics ?? [];
      const judgments = semanticJudgments ?? [];
      const judgeRollup = summarizeSemanticJudgments(judgments);
      const system = PERSONA_SYSTEM.Chairman;
      const user = `EvidencePack:
${evidenceBlock(evidence)}

Independent (compact):
${JSON.stringify(compactIndependent(independent))}
Debate:
${JSON.stringify(debate)}
ClaimCalibrations (compact):
${JSON.stringify(compactCalibrations(cals))}
EvidenceSemantics (compact):
${JSON.stringify(compactSemantics(sems))}
SemanticJudgments rollup:
${JSON.stringify(judgeRollup)}
SemanticJudgments (compact):
${JSON.stringify(compactJudgments(judgments))}
Revisions (compact):
${JSON.stringify(compactRevisions(revs))}
Critic:
${JSON.stringify(critic)}

Separate Fact / Interpretation / Hypothesis. Do NOT invent cases that did not occur. No majority-only conclusions.
Clearly separate "data is missing/null" from "value is low".
Do NOT invent TP/FP counts for live runs — report ambiguous + leap counts + calibrationAgreement disagreements.

Return ONE compact JSON object (no markdown). Prefer short string arrays (max 8 items each).
Include: statusSummary, overallTrendScore, dimensionScores, topProblems, improvements,
expectedUserEffect, expectedDifficulty, risk, improvementEvidence, opinionDifferences, confidence,
needsFurtherVerification, confirmedFacts, crossSourceDivergences, observations, unknownMissingData,
hypotheses, disputedPoints, validatedImprovements, supportedClaims, partiallySupportedClaims,
unsupportedHypothesisClaims, directlySupportedClaims, supportedInferences, weakLimitedInferences,
calibrationRevisionFindings, evidenceSemanticsFindings, semanticJudgeFindings, semanticRisks,
revisionSummary { unchanged, partial, full, confidenceShifts, claimSofteningFromEvidenceGap, herdingRisks }.
crossSourceDivergences = GA≠DB style observations only (never root-cause labels).
needsFurtherVerification holds verification tasks (no separate verificationTasks field).`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      const rs = (o.revisionSummary && typeof o.revisionSummary === 'object'
        ? o.revisionSummary
        : {}) as Record<string, unknown>;
      const revisionSummary: RevisionSummaryBlock = {
        unchanged: asStringArray(rs.unchanged),
        partial: asStringArray(rs.partial),
        full: asStringArray(rs.full),
        confidenceShifts: asStringArray(rs.confidenceShifts),
        claimSofteningFromEvidenceGap: asStringArray(rs.claimSofteningFromEvidenceGap),
        herdingRisks: asStringArray(rs.herdingRisks),
      };
      return {
        statusSummary: asString(o.statusSummary),
        overallTrendScore: typeof o.overallTrendScore === 'number' ? o.overallTrendScore : null,
        dimensionScores: normalizeDimensionScores(parseScores(o.dimensionScores)),
        topProblems: asStringArray(o.topProblems),
        improvements: parseImprovements(o.improvements),
        expectedUserEffect: asString(o.expectedUserEffect),
        expectedDifficulty: asString(o.expectedDifficulty),
        risk: asString(o.risk),
        improvementEvidence: asStringArray(o.improvementEvidence),
        opinionDifferences: asStringArray(o.opinionDifferences),
        confidence: typeof o.confidence === 'number' ? o.confidence : 0.5,
        needsFurtherVerification: asStringArray(o.needsFurtherVerification),
        confirmedFacts: asStringArray(o.confirmedFacts),
        crossSourceDivergences: asStringArray(o.crossSourceDivergences),
        observations: asStringArray(o.observations),
        unknownMissingData: asStringArray(o.unknownMissingData),
        hypotheses: asStringArray(o.hypotheses),
        disputedPoints: asStringArray(o.disputedPoints),
        validatedImprovements: asStringArray(o.validatedImprovements),
        supportedClaims: asStringArray(o.supportedClaims),
        partiallySupportedClaims: asStringArray(o.partiallySupportedClaims),
        unsupportedHypothesisClaims: asStringArray(o.unsupportedHypothesisClaims),
        calibrationRevisionFindings: asStringArray(o.calibrationRevisionFindings),
        evidenceSemanticsFindings: asStringArray(o.evidenceSemanticsFindings),
        semanticJudgeFindings: asStringArray(o.semanticJudgeFindings),
        semanticRisks: asStringArray(o.semanticRisks),
        directlySupportedClaims: asStringArray(o.directlySupportedClaims),
        supportedInferences: asStringArray(o.supportedInferences),
        weakLimitedInferences: asStringArray(o.weakLimitedInferences),
        revisionSummary,
      };
    },
  };
}
