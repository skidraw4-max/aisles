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
import { MIN_SYNDICATED_BODY_CHARS } from '@/lib/syndication-content-standards';
import {
  GEO_FACTUAL_WRITING_CONSTRAINTS,
  GEO_NEWS_INTRO_THREE_LINE_CONSTRAINT,
} from '@/lib/geo-prompt-constraints';
import { retryOnGeminiRateLimit } from '@/lib/news-sync/gemini-request-gap';

const SYSTEM = `너는 IT·테크 뉴스를 **일반인도 이해하기 쉬운 한국어**로 풀어 쓰는 에디터다. 입력은 Techmeme 헤드라인(영문)과 웹에서 추출한 기사 평문이다.

반드시 지킬 것:
1. **핵심 IT 이슈**를 비전문가도 따라갈 수 있게 설명한다(배경·왜 중요한지).
2. **이 기술·소식이 바꿀 미래**(산업·일·사회·규제 등)를 \`futureOutlook\`과 본문 전반에 분명히 담는다.
3. **전문 용어**는 처음 등장 시 **한글 표기 뒤 괄호에 원어(영문) 병기**한다. 예: 대규모 언어 모델(LLM), 그래픽 처리 장치(GPU).

품질: 단순 나열이 아니라 서술형 깊이. 아래 필드 문자 수를 합쳐 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함) 이상 되도록 쓴다.

아래 JSON **한 개만** 출력하라. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. 반드시 "[Techmeme 요약]" 으로 시작한 뒤, 원문을 한 줄로 잘 요약한 **한국어** 제목을 붙여라.
- "introduction": 문자열. 2~5문장 도입.
- "backgroundContext": 문자열. **배경 설명** — 맥락·용어 병기 규칙 준수. "\\n\\n" 문단 구분 허용.
- "sections": 배열. 원문에 맞게 **최소 3개, 많으면 6개까지** 객체. 각 객체는 "title"과 "content" 필수.
- "valueAndInsight": 문자열. 가치·시사점.
- "futureOutlook": 문자열. **미래에 미칠 변화**를 구체적으로. "\\n\\n" 허용.
- "techStackOrMeta": 문자열. 기술 메타가 있으면 bullet, 없으면 "".

JSON만 출력한다.

${GEO_FACTUAL_WRITING_CONSTRAINTS}
${GEO_NEWS_INTRO_THREE_LINE_CONSTRAINT}`;

export async function summarizeTechmemeArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
): Promise<{ ok: true; data: GeekNewsArticleJson } | { ok: false; error: string }> {
  const user = `Techmeme 헤드라인(영문): ${title}\n\n원문 본문(평문):\n${bodyPlain}`;
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
        const result = await retryOnGeminiRateLimit(
          () => model.generateContent(prompt),
          'techmeme/summarize',
        );
        const text = result.response.text().trim();
        const parsed = tryParseJsonFromModelText(text);
        if (!parsed.ok) {
          lastErr = new Error('JSON parse failed');
          console.warn('[techmeme/summarize] JSON 파싱 실패 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        const data = parseGeekNewsArticleJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid article JSON shape');
          console.warn('[techmeme/summarize] 스키마 불일치 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        console.log('[techmeme/summarize] Gemini 요약 완료', {
          modelId,
          apiVersion,
          title: data.postTitle.slice(0, 72),
        });
        return { ok: true, data };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) {
          console.warn('[techmeme/summarize] 모델·API 경로 불가 → 다음 후보', {
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
          console.warn('[techmeme/summarize] 일시 과부하(503 등) → 다음 모델·버전 시도', {
            modelId,
            apiVersion,
          });
          continue;
        }
        console.warn('[techmeme/summarize] 일시 오류 → 다음 후보', {
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
