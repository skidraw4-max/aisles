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
import { ANTI_HERDING_DEBATE_RULES, MEMBER_FOCUS, PERSONA_SYSTEM } from './personas';
import { formatEvidencePackForPrompt } from './format-evidence-prompt';
import { SCORE_DIMENSIONS } from './score-dimensions';
import { listScoresLackingHardEvidence, normalizeDimensionScores } from './scoring';
import { assertIndependentContext } from './independence';
import type { ReviewBoardLlm } from './llm';
import type {
  CommitteeAnalystId,
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
  RevisionStatus,
} from './types';
import { isRevisionStatus, revisionStatusImpliesChange } from './types';

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

Peer independent analyses (now visible):
${JSON.stringify(peers.filter((p) => p.memberId !== memberId), null, 2)}

Return JSON:
{
  "agreement": string[],
  "disagreement": string[],
  "weakEvidence": string[],
  "missed": string[],
  "needsVerification": string[],
  "revisionStatus": "UNCHANGED" | "PARTIAL" | "FULL",
  "revised": boolean,
  "revisionReason": string,
  "previousOpinion": string|null,
  "revisedOpinion": string|null,
  "finalOpinion": string,
  "confidence": number
}

revisionStatus 선택 가이드: 바꾸라고 강요되지 않는다. 동료 반박이 네 근거를 실제로 무너뜨리면 PARTIAL/FULL, 아니면 UNCHANGED.
revised 는 revisionStatus가 PARTIAL 또는 FULL 일 때만 true.`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
      let revisionStatus: RevisionStatus = isRevisionStatus(o.revisionStatus)
        ? o.revisionStatus
        : Boolean(o.revised)
          ? 'PARTIAL'
          : 'UNCHANGED';
      const revised = revisionStatusImpliesChange(revisionStatus);
      const turn: DebateTurn = {
        memberId,
        agreement: asStringArray(o.agreement),
        disagreement: asStringArray(o.disagreement),
        weakEvidence: asStringArray(o.weakEvidence),
        missed: asStringArray(o.missed),
        needsVerification: asStringArray(o.needsVerification),
        revisionStatus,
        revised,
        revisionReason: asString(
          o.revisionReason,
          revised ? 'unspecified' : 'kept independent judgment',
        ),
        previousOpinion: revised
          ? asString(o.previousOpinion, own.originalOpinion)
          : asString(o.previousOpinion, own.originalOpinion) || own.originalOpinion,
        revisedOpinion: revised ? asString(o.revisedOpinion, asString(o.finalOpinion)) : null,
        finalOpinion: asString(o.finalOpinion, own.originalOpinion),
        confidence: typeof o.confidence === 'number' ? Math.min(1, Math.max(0, o.confidence)) : own.confidence,
      };
      if (!turn.revisionReason) {
        turn.revisionReason = revised ? 'missing_reason_filled_by_guard' : 'unchanged';
      }
      return turn;
    },

    async critic(evidence, independent, debate): Promise<CriticReport> {
      const lacking = independent.flatMap((i) =>
        listScoresLackingHardEvidence(i.scores).map((d) => `${i.memberId}:${d}`),
      );
      const system = PERSONA_SYSTEM.F;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Independent:\n${JSON.stringify(independent, null, 2)}

Debate:\n${JSON.stringify(debate, null, 2)}

Precomputed scoresWithoutEvidence candidates: ${JSON.stringify(lacking)}

Return JSON with boolean fields:
factVsSpeculationOk, evidenceSufficient, herdingDetected, trendEvidenceOk, userBenefitLikely,
existingFeatureRisk, overEngineering,
scoresWithoutEvidence: string[],
dominantMemberInfluence: string|null,
notes: string[],
confidence: number`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
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
      };
    },

    async chairman(evidence, independent, debate, critic): Promise<FinalReport> {
      const system = PERSONA_SYSTEM.Chairman;
      const user = `EvidencePack:\n${evidenceBlock(evidence)}

Independent:\n${JSON.stringify(independent, null, 2)}
Debate:\n${JSON.stringify(debate, null, 2)}
Critic:\n${JSON.stringify(critic, null, 2)}

Do NOT use simple average/majority only. Weight evidence and confidence.
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
  "needsFurtherVerification": string[]
}`;
      const res = await geminiJson(key, system, user);
      if (!res.ok) throw new Error(res.error);
      const o = res.parsed as Record<string, unknown>;
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
      };
    },
  };
}
