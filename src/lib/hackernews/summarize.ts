import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GEMINI_API_VERSION_CHAIN,
  GEMINI_GEEKNEWS_MODEL_CHAIN,
} from '@/lib/gemini-models';
import type { GeekNewsArticleJson } from '@/lib/geeknews/summarize';
import { parseGeekNewsArticleJson } from '@/lib/geeknews/summarize';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';

const SYSTEM = `너는 개발자·IT 독자를 위한 한국어 에디터다. 입력은 Hacker News 스토리 제목과 웹에서 추출한 기사 평문이다.

아래 JSON **한 개만** 출력하라. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. 반드시 "[Hacker News 요약]" 으로 시작한 뒤, 원문을 한 줄로 잘 요약한 제목을 붙여라.
- "introduction": 문자열. 2~4문장 도입.
- "sections": 배열. 원문에 맞게 **최소 3개, 많으면 6개까지** 객체. 각 객체는 "title"과 "content" 필수.
- "valueAndInsight": 문자열. 가치·시사점.
- "techStackOrMeta": 문자열. 기술 메타가 있으면 bullet 형식, 없으면 "".

JSON만 출력한다.`;

export async function summarizeHackerNewsArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
): Promise<{ ok: true; data: GeekNewsArticleJson } | { ok: false; error: string }> {
  const user = `Hacker News 제목: ${title}\n\n원문 본문(평문):\n${bodyPlain}`;
  const prompt = `${SYSTEM}\n\n---\n\n${user}`;

  let lastErr: unknown;

  for (const modelId of GEMINI_GEEKNEWS_MODEL_CHAIN) {
    for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel(
          {
            model: modelId,
            generationConfig: {
              temperature: 0.28,
              maxOutputTokens: 8192,
            },
          },
          { apiVersion },
        );
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const parsed = tryParseJsonFromModelText(text);
        if (!parsed.ok) {
          lastErr = new Error('JSON parse failed');
          console.warn('[hackernews/summarize] JSON 파싱 실패 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        const data = parseGeekNewsArticleJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid article JSON shape');
          console.warn('[hackernews/summarize] 스키마 불일치 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        console.log('[hackernews/summarize] Gemini 요약 완료', {
          modelId,
          apiVersion,
          title: data.postTitle.slice(0, 72),
        });
        return { ok: true, data };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) {
          console.warn('[hackernews/summarize] 모델·API 경로 불가 → 다음 후보', {
            modelId,
            apiVersion,
            message: e instanceof Error ? e.message.slice(0, 200) : String(e),
          });
          continue;
        }
        const classified = classifyGeminiFailure(e);
        if (classified.category === 'AUTH' || classified.category === 'RATE_LIMIT') {
          return { ok: false, error: classified.userMessage };
        }
        if (classified.category === 'SERVER') {
          console.warn('[hackernews/summarize] 일시 과부하(503 등) → 다음 모델·버전 시도', {
            modelId,
            apiVersion,
          });
          continue;
        }
        console.warn('[hackernews/summarize] 일시 오류 → 다음 후보', {
          modelId,
          apiVersion,
          category: classified.category,
        });
        continue;
      }
    }
  }

  return {
    ok: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'Gemini 요약 실패'),
  };
}
