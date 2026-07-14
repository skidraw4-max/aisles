import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import type { AiFortuneAggregateContext } from '@/lib/ai-fortune/aggregate-context';
import { formatAggregateForPrompt } from '@/lib/ai-fortune/aggregate-context';
import { AI_FORTUNE_SYSTEM_PROMPT } from '@/lib/ai-fortune/fortune-system-prompt';
import { looksPrimarilyEnglish } from '@/lib/ai-fortune/korean-text';
import { aiFortunePostTitle } from '@/lib/ai-fortune/kst-week';
import type { AiFortuneNewsContext } from '@/lib/ai-fortune/load-news-context';
import {
  describeAiFortuneWeeklyPayloadIssues,
  parseAiFortuneWeeklyPayload,
  type AiFortuneWeeklyPayload,
} from '@/lib/ai-fortune/payload';
import { MBTI_TYPES } from '@/lib/ai-fortune/mbti';

export type { AiFortuneWeeklyPayload, AiFortuneMbtiEntry } from '@/lib/ai-fortune/payload';
export { AI_FORTUNE_SYSTEM_PROMPT } from '@/lib/ai-fortune/fortune-system-prompt';

const MBTI_LIST = MBTI_TYPES.join(', ');

const VALIDATION_ERROR_MESSAGE =
  'AI FORTUNE JSON 형식이 올바르지 않습니다 (트렌드 3~5개, MBTI 16유형, 한국어).';

const MAX_VALIDATION_ATTEMPTS = 3;

function buildFixUserPrompt(
  baseUserPrompt: string,
  weekLabel: string,
  issues: string[],
): string {
  return `${baseUserPrompt}

이전 응답이 스키마 검증에 실패했습니다. 아래 문제를 모두 수정한 JSON만 다시 출력하세요.
검증 오류:
${issues.map((i) => `- ${i}`).join('\n')}

필수: trendBullets 3~5개(각 16자 이상, **한국어 본문** — 영어 문장 금지), mbti 정확히 16개, type은 ${MBTI_LIST} 각 1회(영문 대문자 4글자).
weekLabel은 "${weekLabel}" 그대로 사용.`;
}

async function geminiJsonPrompt(
  apiKey: string,
  system: string,
  user: string,
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  let lastErr: unknown;
  let lastParseFail: { modelId: string; apiVersion: string; textLen: number } | null = null;

  for (const modelId of GEMINI_GEEKNEWS_MODEL_CHAIN) {
    for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
          {
            model: modelId,
            generationConfig: {
              temperature: 0.5,
              responseMimeType: 'application/json',
            },
            systemInstruction: system,
          },
          { apiVersion },
        );
        const result = await model.generateContent(user);
        const text = result.response.text();
        const parsed = tryParseJsonFromModelText(text);
        if (parsed.ok) {
          return { ok: true, parsed: parsed.value };
        }
        lastParseFail = { modelId, apiVersion, textLen: text.length };
        console.warn('[ai-fortune] Gemini JSON 파싱 실패 → 다음 후보', lastParseFail);
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (classified.category === 'RATE_LIMIT' || classified.category === 'SERVER') {
          return { ok: false, error: classified.userMessage };
        }
        console.warn('[ai-fortune] Gemini 호출 오류 → 다음 후보', {
          modelId,
          apiVersion,
          category: classified.category,
        });
      }
    }
  }

  if (lastParseFail) {
    console.error('[ai-fortune] 모든 모델에서 JSON 파싱 실패', lastParseFail);
    return { ok: false, error: 'JSON 파싱 실패' };
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
  const baseUserPrompt = `분석 기준 주차: ${weekLabel} (KST, 지난 약 7일)

[지난주 헤드라인·게시물]
${news.promptBlock}

[AIsle 커뮤니티 집계]
${aggregateText}

weekLabel 필드에는 "${weekLabel}" 을 그대로 넣으세요.`;

  let userPrompt = baseUserPrompt;
  let lastIssues: string[] = [];

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    const res = await geminiJsonPrompt(apiKey, AI_FORTUNE_SYSTEM_PROMPT, userPrompt);
    if (!res.ok) {
      console.error('[ai-fortune] Gemini 생성 실패', { attempt, error: res.error });
      return { ok: false, error: res.error };
    }

    const raw =
      typeof res.parsed === 'object' && res.parsed !== null
        ? ({ ...(res.parsed as Record<string, unknown>) } as Record<string, unknown>)
        : ({} as Record<string, unknown>);
    if (!raw.weekLabel) raw.weekLabel = weekLabel;

    const data = parseAiFortuneWeeklyPayload(raw);
    if (data && !data.trendBullets.some((t) => looksPrimarilyEnglish(t))) {
      if (attempt > 1) {
        console.log('[ai-fortune] 검증 재시도 성공', { attempt });
      }
      return {
        ok: true,
        title: aiFortunePostTitle(),
        data: { ...data, weekLabel: data.weekLabel || weekLabel },
      };
    }

    lastIssues = describeAiFortuneWeeklyPayloadIssues(raw);
    if (data && data.trendBullets.some((t) => looksPrimarilyEnglish(t))) {
      lastIssues = [
        ...lastIssues,
        'trendBullets: English-only items detected — rewrite in Korean',
      ];
    }
    const topKeys =
      typeof raw === 'object' && raw !== null ? Object.keys(raw).slice(0, 12) : [];
    console.warn('[ai-fortune] 페이로드 검증 실패', {
      attempt,
      issues: lastIssues,
      topKeys,
      mbtiLen: Array.isArray(raw.mbti) ? raw.mbti.length : null,
      trendLen: Array.isArray(raw.trendBullets) ? raw.trendBullets.length : null,
    });

    if (attempt < MAX_VALIDATION_ATTEMPTS) {
      userPrompt = buildFixUserPrompt(baseUserPrompt, weekLabel, lastIssues);
    }
  }

  console.error('[ai-fortune] 페이로드 검증 최종 실패', {
    attempts: MAX_VALIDATION_ATTEMPTS,
    issues: lastIssues,
  });
  return { ok: false, error: VALIDATION_ERROR_MESSAGE };
}
