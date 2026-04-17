import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN } from '@/lib/gemini-models';
import { tryParseJsonFromModelText } from '@/lib/gemini-prompt-analysis-engine';

/** 요구사항: Gemini 1.5 Flash */
const GEEKNEWS_SUMMARY_MODEL = 'gemini-1.5-flash-latest';

const SYSTEM = `너는 기술 뉴스를 한국어로 정리하는 에디터다.
입력으로 웹 기사 본문(평문)이 주어진다.

반드시 아래 키만 갖는 JSON 한 개만 출력하라. 마크다운·코드펜스·설명 문장 금지.
- "lines": 문자열 배열, 정확히 3개 요소. 각 요소는 개발자에게 유용한 한국어 한 문장 요약(서로 다른 관점).
- "insight": 문자열 1개. 한 문장 인사이트(왜 중요한지·시사점).

JSON 예: {"lines":["…","…","…"],"insight":"…"}`;

export type GeekNewsSummaryJson = {
  lines: [string, string, string];
  insight: string;
};

function isThreeLines(v: unknown): v is [string, string, string] {
  if (!Array.isArray(v) || v.length !== 3) return false;
  return v.every((x) => typeof x === 'string' && x.trim().length > 0);
}

export async function summarizeGeekNewsArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
): Promise<{ ok: true; data: GeekNewsSummaryJson } | { ok: false; error: string }> {
  const trimmedBody = bodyPlain.slice(0, 48_000);
  const user = `제목: ${title}\n\n본문:\n${trimmedBody}`;

  let lastErr: unknown;
  for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel(
        {
          model: GEEKNEWS_SUMMARY_MODEL,
          systemInstruction: SYSTEM,
          generationConfig: { temperature: 0.25, maxOutputTokens: 1024 },
        },
        { apiVersion },
      );
      const result = await model.generateContent(user);
      const text = result.response.text().trim();
      const parsed = tryParseJsonFromModelText(text);
      if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) {
        lastErr = new Error('JSON parse failed');
        continue;
      }
      const o = parsed.value as Record<string, unknown>;
      const lines = o.lines;
      const insight = o.insight;
      if (!isThreeLines(lines) || typeof insight !== 'string' || !insight.trim()) {
        lastErr = new Error('Invalid summary shape');
        continue;
      }
      return {
        ok: true,
        data: {
          lines: [lines[0]!.trim(), lines[1]!.trim(), lines[2]!.trim()],
          insight: insight.trim(),
        },
      };
    } catch (e) {
      lastErr = e;
      if (e instanceof GoogleGenerativeAIFetchError && e.status === 404) {
        continue;
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return {
    ok: false,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'Gemini 요약 실패'),
  };
}
