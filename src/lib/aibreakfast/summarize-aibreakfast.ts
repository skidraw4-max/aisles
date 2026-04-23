import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import {
  MIN_SYNDICATED_BODY_CHARS,
  totalCharCount,
} from '@/lib/syndication-content-standards';

const SYSTEM = `너는 AI·테크 뉴스레터를 한국어 독자에게 전달하는 에디터다.

입력은 뉴스레터 전체 본문(평문)이다.

품질: 뉴스레터 전체 맥락에서 **배경**과 **향후 전망**을 명시하고, 각 주제 요약은 충분한 분량으로 쓴다.
토픽 요약·배경·전망·헤드라인·인사이트 문자를 합쳐 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함) 이상 되도록 한다.

아래 JSON **한 개만** 출력한다. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

출력에는 **이미지·로고·배너 URL, 마크다운 이미지 문법(\`![...](...)\`)**을 넣지 않는다. 순수 텍스트만.

스키마:
- "postTitle": 문자열. "[AI Breakfast]" 로 시작하고, 이번 이슈를 한 줄로 요약한 제목.
- "newsletterBackground": 문자열. **배경 설명** — 이번 호가 다루는 시장·정책·제품 물결의 큰 그림 (여러 문단 허용 "\\n\\n").
- "futureOutlook": 문자열. **향후 전망** — 구독자가 다음 주까지 주목할 변수.
- "topics": **정확히 3개**의 객체 배열. 핵심 주제 3가지:
  - "headline": 한글 짧은 주제 제목 (한 줄)
  - "summary": 해당 주제 요약 (**4~8문장**, 구체적으로, 실명·제품명을 살리되 과장 금지)
  - "insight": 독자가 챙길 **한 줄 인사이트** (한국어)

JSON만 출력한다.`;

export type AiBreakfastTopic = {
  headline: string;
  summary: string;
  insight: string;
};

export type AiBreakfastSummaryJson = {
  postTitle: string;
  newsletterBackground: string;
  futureOutlook: string;
  topics: [AiBreakfastTopic, AiBreakfastTopic, AiBreakfastTopic];
};

function parseAiBreakfastJson(value: unknown): AiBreakfastSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.postTitle !== 'string' || !o.postTitle.trim()) return null;
  const newsletterBackground =
    typeof o.newsletterBackground === 'string' ? o.newsletterBackground.trim() : '';
  const futureOutlook = typeof o.futureOutlook === 'string' ? o.futureOutlook.trim() : '';
  if (newsletterBackground.length < 80 || futureOutlook.length < 60) return null;
  if (!Array.isArray(o.topics) || o.topics.length !== 3) return null;
  const topics: AiBreakfastTopic[] = [];
  for (const t of o.topics) {
    if (typeof t !== 'object' || t === null) return null;
    const x = t as Record<string, unknown>;
    const headline = typeof x.headline === 'string' ? x.headline.trim() : '';
    const summary = typeof x.summary === 'string' ? x.summary.trim() : '';
    const insight = typeof x.insight === 'string' ? x.insight.trim() : '';
    if (headline.length < 2 || summary.length < 120 || insight.length < 4) return null;
    topics.push({ headline, summary, insight });
  }
  const merged: AiBreakfastSummaryJson = {
    postTitle: o.postTitle.trim(),
    newsletterBackground,
    futureOutlook,
    topics: [topics[0]!, topics[1]!, topics[2]!],
  };
  const topicChars = topics.flatMap((t) => [t.headline, t.summary, t.insight]);
  if (
    totalCharCount([merged.newsletterBackground, merged.futureOutlook, ...topicChars]) <
    MIN_SYNDICATED_BODY_CHARS
  ) {
    return null;
  }
  return merged;
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
