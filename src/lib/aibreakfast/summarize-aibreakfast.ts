import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';

const SYSTEM = `너는 AI·테크 뉴스레터를 한국어 독자에게 전달하는 에디터다.

입력은 뉴스레터 전체 본문(평문)이다.

아래 JSON **한 개만** 출력한다. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

출력에는 **이미지·로고·배너 URL, 마크다운 이미지 문법(\`![...](...)\`)**을 넣지 않는다. 순수 텍스트만.

스키마:
- "postTitle": 문자열. "[AI Breakfast]" 로 시작하고, 이번 이슈를 한 줄로 요약한 제목.
- "topics": **정확히 3개**의 객체 배열. 이 뉴스레터의 **핵심 주제 3가지**를 각각 다음 형식으로:
  - "headline": 한글 짧은 주제 제목 (한 줄)
  - "summary": 해당 주제에 대한 한국어 요약 (2~4문장, 구체적으로)
  - "insight": 독자가 챙길 **한 줄 인사이트** (한국어)

JSON만 출력한다.`;

export type AiBreakfastTopic = {
  headline: string;
  summary: string;
  insight: string;
};

export type AiBreakfastSummaryJson = {
  postTitle: string;
  topics: [AiBreakfastTopic, AiBreakfastTopic, AiBreakfastTopic];
};

function parseAiBreakfastJson(value: unknown): AiBreakfastSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.postTitle !== 'string' || !o.postTitle.trim()) return null;
  if (!Array.isArray(o.topics) || o.topics.length !== 3) return null;
  const topics: AiBreakfastTopic[] = [];
  for (const t of o.topics) {
    if (typeof t !== 'object' || t === null) return null;
    const x = t as Record<string, unknown>;
    const headline = typeof x.headline === 'string' ? x.headline.trim() : '';
    const summary = typeof x.summary === 'string' ? x.summary.trim() : '';
    const insight = typeof x.insight === 'string' ? x.insight.trim() : '';
    if (headline.length < 2 || summary.length < 20 || insight.length < 4) return null;
    topics.push({ headline, summary, insight });
  }
  return {
    postTitle: o.postTitle.trim(),
    topics: [topics[0]!, topics[1]!, topics[2]!],
  };
}

const MAX_BODY_CHARS = 120_000;

export async function summarizeAiBreakfastNewsletter(
  apiKey: string,
  bodyPlain: string,
): Promise<{ ok: true; data: AiBreakfastSummaryJson } | { ok: false; error: string }> {
  const clipped = bodyPlain.length > MAX_BODY_CHARS ? bodyPlain.slice(0, MAX_BODY_CHARS) : bodyPlain;
  const user = `뉴스레터 본문(평문):\n\n${clipped}`;
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
              temperature: 0.35,
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
          continue;
        }
        const data = parseAiBreakfastJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid AI Breakfast JSON');
          continue;
        }
        return { ok: true, data };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (classified.category === 'AUTH' || classified.category === 'RATE_LIMIT') {
          return { ok: false, error: classified.userMessage };
        }
        if (classified.category === 'SERVER') {
          console.warn('[aibreakfast/summarize] 일시 과부하 → 다음 모델·버전', {
            modelId,
            apiVersion,
          });
          continue;
        }
        continue;
      }
    }
  }

  return {
    ok: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown'),
  };
}
