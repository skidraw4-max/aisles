import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  readGeminiApiKeyFromEnv,
} from '@/lib/gemini-prompt-analysis-engine';
import {
  GEMINI_API_VERSION_CHAIN,
  GEMINI_GEEKNEWS_MODEL_CHAIN,
} from '@/lib/gemini-models';
import { ANTI_HERDING_DEBATE_RULES, MEMBER_FOCUS, PERSONA_SYSTEM, REVISION_QUALITY_RULES, REVISION_Q_CHECKLIST } from './personas';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import { SCORE_DIMENSIONS } from './score-dimensions';
import { listScoresLackingHardEvidence, normalizeDimensionScores } from './scoring';
import { assertIndependentContext } from './independence';
import { listRevisionIntegrityIssues, normalizeRevisionRecord } from './revision-quality';
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
  FinalReport,
  IndependentAnalysis,
  ImprovementItem,
  LlmContext,
  RevisionRecord,
  RevisionSummaryBlock,
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
        return null;
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
  for (const modelId of GEMINI_GEEKNEWS_MODEL_CHAIN) {
    for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
          {
            model: modelId,
            generationConfig: {
              temperature: 0.4,
              responseMimeType: 'application/json',
            },
            systemInstruction: system,
          },
          { apiVersion },
        );
        const result = await model.generateContent(user);
        const parsed = tryParseJson(result.response.text());
        if (parsed) return { ok: true, parsed };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (classified.category === 'RATE_LIMIT' || classified.category === 'SERVER') {
          return { ok: false, error: classified.userMessage };
        }
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  return { ok: false, error: msg || 'Gemini JSON failed' };
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

    async revisionPass(memberId, evidence, own, ownDebate, peers) {
      const system = `${PERSONA_SYSTEM[memberId]}\n${REVISION_QUALITY_RULES}\n${REVISION_Q_CHECKLIST}`;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Your independent analysis (originalOpinion is immutable history):
${JSON.stringify(own, null, 2)}

Your debate turn (rebuttals / gaps):
${JSON.stringify(ownDebate, null, 2)}

Peer independent analyses (arguments only — do NOT use majority agreement as retain/revision/confidence ground):
${JSON.stringify(peers.filter((p) => p.memberId !== memberId), null, 2)}

Do NOT choose PARTIAL/FULL just to satisfy the experiment. If UNCHANGED is most rational, choose UNCHANGED with concrete retainReason.

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
      });
    },

    async critic(evidence, independent, debate, revisions): Promise<CriticReport> {
      const lacking = independent.flatMap((i) =>
        listScoresLackingHardEvidence(i.scores).map((d) => `${i.memberId}:${d}`),
      );
      const revs = revisions ?? [];
      const preFlags = revs.flatMap((r) =>
        listRevisionIntegrityIssues(r).map((i) => `${r.memberId}:${i}`),
      );
      const system = PERSONA_SYSTEM.F;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Independent:\n${JSON.stringify(independent, null, 2)}

Debate:\n${JSON.stringify(debate, null, 2)}

Revisions:\n${JSON.stringify(revs, null, 2)}

Precomputed scoresWithoutEvidence candidates: ${JSON.stringify(lacking)}
Precomputed revision integrity flags: ${JSON.stringify(preFlags)}

Return JSON:
{
  "factVsSpeculationOk": boolean,
  "evidenceSufficient": boolean,
  "scoresWithoutEvidence": string[],
  "herdingDetected": boolean,
  "dominantMemberInfluence": string|null,
  "trendEvidenceOk": boolean,
  "userBenefitLikely": boolean,
  "existingFeatureRisk": boolean,
  "overEngineering": boolean,
  "notes": string[],
  "confidence": number,
  "revisionIntegrity": {"ok": boolean, "flags": string[]},
  "evidenceGrounding": {"ok": boolean, "flags": string[]},
  "overclaiming": {"ok": boolean, "flags": string[]},
  "herding": {"ok": boolean, "flags": string[]},
  "confidenceIntegrity": {"ok": boolean, "flags": string[]},
  "fabrication": {"ok": boolean, "flags": string[]},
  "statusConsistency": {"ok": boolean, "flags": string[]}
}

Flag UNCHANGED+changed final opinion, PARTIAL with identical opinions, majority-as-ground, fabricated metrics, confidence jumps without reason.`;
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
        overclaiming: parseCheck(o.overclaiming),
        herding: parseCheck(o.herding),
        confidenceIntegrity: parseCheck(o.confidenceIntegrity),
        fabrication: parseCheck(o.fabrication),
        statusConsistency: parseCheck(o.statusConsistency),
      };
    },

    async chairman(evidence, independent, debate, critic, revisions): Promise<FinalReport> {
      const revs = revisions ?? [];
      const system = PERSONA_SYSTEM.Chairman;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Independent:\n${JSON.stringify(independent, null, 2)}
Debate:\n${JSON.stringify(debate, null, 2)}
Revisions:\n${JSON.stringify(revs, null, 2)}
Critic:\n${JSON.stringify(critic, null, 2)}

Do NOT use simple average/majority only. Weight evidence and confidence.
Do NOT invent revision cases that did not occur.

Return JSON:
{
  "statusSummary": string,
  "overallTrendScore": number|null,
  "dimensionScores": [...],
  "topProblems": string[],
  "improvements": [...],
  "expectedUserEffect": string,
  "expectedDifficulty": string,
  "risk": string,
  "improvementEvidence": string[],
  "opinionDifferences": string[],
  "confidence": number,
  "needsFurtherVerification": string[],
  "confirmedFacts": string[],
  "unknownMissingData": string[],
  "hypotheses": string[],
  "disputedPoints": string[],
  "validatedImprovements": string[],
  "revisionSummary": {
    "unchanged": string[],
    "partial": string[],
    "full": string[],
    "confidenceShifts": string[],
    "claimSofteningFromEvidenceGap": string[],
    "herdingRisks": string[]
  }
}`;
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
        unknownMissingData: asStringArray(o.unknownMissingData),
        hypotheses: asStringArray(o.hypotheses),
        disputedPoints: asStringArray(o.disputedPoints),
        validatedImprovements: asStringArray(o.validatedImprovements),
        revisionSummary,
      };
    },
  };
}
