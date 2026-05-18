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
import type { AiFortuneNewsContext } from '@/lib/ai-fortune/load-news-context';
import { parseAiFortuneWeeklyPayload, type AiFortuneWeeklyPayload } from '@/lib/ai-fortune/payload';

export type { AiFortuneWeeklyPayload, AiFortuneMbtiEntry } from '@/lib/ai-fortune/payload';

const FORTUNE_SYSTEM = `너는 AI 시대의 유머러스한 커리어 점술가이자 글로벌 AI 트렌드 애널리스트다.

입력: (1) 지난 7일 Techmeme·Hacker News·AIsle 게시 헤드라인 (2) AIsle 커뮤니티 북마크 집계(개인 식별 없음)

작업:
1. 헤드라인·집계를 바탕으로 지난주 글로벌 AI 핵심 트렌드 3~5개를 분석한다. 각 트렌드는 2~3문장, 구체적 제품·연구·이슈를 포함한다.
2. 그 트렌드를 바탕으로 MBTI 16유형(INTJ, INTP, ENTJ, ENTP, INFJ, INFP, ENFJ, ENFP, ISTJ, ISFJ, ESTJ, ESFJ, ISTP, ISFP, ESTP, ESFP) 각각에 대해 이번 주:
   - strategy: AI 활용 전략 (2~4문장, 한국어, 재치 있으나 실질적)
   - luckyKeyword: 행운의 AI 도구·키워드 (짧은 구 1~3개)
   - avoidHabit: 피해야 할 습관·행동 (1~3문장)

출력은 JSON 한 개만:
{
  "weekLabel": "2026년 5월 3주차",
  "trendBullets": ["...", "...", "..."],
  "mbti": [
    { "type": "INTJ", "strategy": "...", "luckyKeyword": "...", "avoidHabit": "..." },
    ... 16개 전부, type은 위 16유형 각 1회
  ],
  "closingNote": "이번 주 리포트 마무리 한 줄 (선택)"
}
마크다운 코드펜스·설명 문장 밖 텍스트 금지. mbti 배열은 정확히 16개.`;

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
              temperature: 0.6,
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
  news: AiFortuneNewsContext,
  aggregate: AiFortuneAggregateContext,
  weekLabel: string,
): Promise<
  { ok: true; data: AiFortuneWeeklyPayload; title: string } | { ok: false; error: string }
> {
  const aggregateText = formatAggregateForPrompt(aggregate);
  const userPrompt = `분석 기준 주차: ${weekLabel} (KST, 지난 약 7일)

[지난주 헤드라인·게시물]
${news.promptBlock}

[AIsle 커뮤니티 집계]
${aggregateText}

weekLabel 필드에는 "${weekLabel}" 을 그대로 넣으세요.`;

  const res = await geminiJsonPrompt(apiKey, FORTUNE_SYSTEM, userPrompt);
  if (!res.ok) return { ok: false, error: res.error };

  const raw = res.parsed as Record<string, unknown>;
  if (!raw.weekLabel) raw.weekLabel = weekLabel;

  const data = parseAiFortuneWeeklyPayload(raw);
  if (!data) {
    return { ok: false, error: 'AI FORTUNE JSON 형식이 올바르지 않습니다 (트렌드 3~5개, MBTI 16유형).' };
  }

  return {
    ok: true,
    title: aiFortunePostTitle(),
    data: { ...data, weekLabel: data.weekLabel || weekLabel },
  };
}
