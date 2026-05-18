import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import type { AiFortuneAggregateContext } from '@/lib/ai-fortune/aggregate-context';
import { formatAggregateForPrompt } from '@/lib/ai-fortune/aggregate-context';
import { aiFortunePostTitle } from '@/lib/ai-fortune/kst-week';

export type AiFortuneWeeklyJson = {
  trendBullets: string[];
  luckyKeywords: string;
  avoidActions: string;
  learningAreas: string;
  mbtiHighlights: string;
  closingNote: string;
};

const TREND_SYSTEM = `너는 글로벌 AI 산업 트렌드를 추적하는 한국어 테크 애널리스트다.
지난 7일간 전 세계 AI 산업에서 가장 주목할 만한 트렌드 5가지를 분석한다.
각 항목은 2~3문장, 구체적 사례·제품·연구 방향을 포함한다.
출력은 JSON 한 개만: { "trends": ["...", "...", "...", "...", "..."] }
마크다운 코드펜스·설명 문장 밖 텍스트 금지.`;

const FORTUNE_SYSTEM = `너는 AI 시대의 유머러스한 커리어 점술가다.
입력: (1) 지난주 AI 트렌드 5가지 (2) AIsle 커뮤니티 집계(북마크·MBTI, 개인 식별 없음)

한국어로 재치 있게 작성하되, 조언은 실질적이어야 한다.
출력 JSON 한 개만:
{
  "luckyKeywords": "이번 주 행운의 키워드 3~5개 (짧은 구, 쉼표 구분)",
  "avoidActions": "피해야 할 행동 2~4문장 (\\n\\n 문단 가능)",
  "learningAreas": "추천 학습 분야 2~4문장",
  "mbtiHighlights": "다양한 MBTI 유형을 위한 한 줄씩 3~4개 (예: INTJ — …)",
  "closingNote": "My Aisle에서 MBTI를 입력하면 맞춤 운세가 준비된다는 안내 1~2문장"
}
마크다운 코드펜스·설명 문장 밖 텍스트 금지.`;

function parseTrendsJson(value: unknown): string[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const trends = (value as { trends?: unknown }).trends;
  if (!Array.isArray(trends) || trends.length < 3) return null;
  const out = trends
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 20)
    .map((t) => t.trim())
    .slice(0, 5);
  return out.length >= 3 ? out : null;
}

function parseFortuneJson(value: unknown): Omit<AiFortuneWeeklyJson, 'trendBullets'> | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const luckyKeywords = typeof o.luckyKeywords === 'string' ? o.luckyKeywords.trim() : '';
  const avoidActions = typeof o.avoidActions === 'string' ? o.avoidActions.trim() : '';
  const learningAreas = typeof o.learningAreas === 'string' ? o.learningAreas.trim() : '';
  const mbtiHighlights = typeof o.mbtiHighlights === 'string' ? o.mbtiHighlights.trim() : '';
  const closingNote = typeof o.closingNote === 'string' ? o.closingNote.trim() : '';
  if (
    luckyKeywords.length < 8 ||
    avoidActions.length < 40 ||
    learningAreas.length < 40 ||
    mbtiHighlights.length < 30
  ) {
    return null;
  }
  return { luckyKeywords, avoidActions, learningAreas, mbtiHighlights, closingNote };
}

async function geminiJsonPrompt(
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
              temperature: 0.55,
              responseMimeType: 'application/json',
            },
            systemInstruction: system,
          },
          { apiVersion },
        );
        const result = await model.generateContent(user);
        const text = result.response.text();
        const parsed = tryParseJsonFromModelText(text);
        if (parsed != null) return { ok: true, parsed };
        return { ok: false, error: 'JSON 파싱 실패' };
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
  return { ok: false, error: msg || 'Gemini 호출 실패' };
}

export async function generateAiFortuneWeeklyContent(
  apiKey: string,
  aggregate: AiFortuneAggregateContext,
  weekLabel: string,
): Promise<{ ok: true; data: AiFortuneWeeklyJson; title: string } | { ok: false; error: string }> {
  const trendRes = await geminiJsonPrompt(
    apiKey,
    TREND_SYSTEM,
    `분석 기준: ${weekLabel} (KST). 지난주(약 7일) 글로벌 AI 산업 주요 트렌드 5가지를 JSON으로 출력하세요.`,
  );
  if (!trendRes.ok) return { ok: false, error: trendRes.error };
  const trendBullets = parseTrendsJson(trendRes.parsed);
  if (!trendBullets) return { ok: false, error: '트렌드 JSON 형식이 올바르지 않습니다.' };

  const aggregateText = formatAggregateForPrompt(aggregate);
  const fortuneRes = await geminiJsonPrompt(
    apiKey,
    FORTUNE_SYSTEM,
    `주차: ${weekLabel}\n\n[지난주 AI 트렌드]\n${trendBullets.map((t, i) => `${i + 1}. ${t}`).join('\n\n')}\n\n[AIsle 커뮤니티 집계]\n${aggregateText}`,
  );
  if (!fortuneRes.ok) return { ok: false, error: fortuneRes.error };
  const fortune = parseFortuneJson(fortuneRes.parsed);
  if (!fortune) return { ok: false, error: '운세 JSON 형식이 올바르지 않습니다.' };

  return {
    ok: true,
    title: aiFortunePostTitle(),
    data: { trendBullets, ...fortune },
  };
}
