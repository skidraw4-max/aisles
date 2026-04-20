import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';

const SYSTEM = `너는 The Verge 스타일의 테크 저널리즘을 한국어로 옮기는 에디터다. 톤은 날카롭고 트렌디하며, 과장 없이 "왜 지금 이 소식이 중요한지"가 드러나게 쓴다.

입력은 RSS에서 추출한 기사 평문(HTML 제거됨)과 원 제목이다.

아래 JSON **한 개만** 출력한다. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. "[The Verge]" 로 시작하고, 원문 헤드라인을 한국어 독자에게 맞게 다듬은 한 줄 제목.
- "lines": 길이 정확히 3인 문자열 배열. 각 항목은 한 문단으로, 기술적 통찰·맥락·영향이 담기도록 서로 겹치지 않게 작성.
- "takeaway": 문자열. 1줄 시사점(독자가 챙길 한 가지).

JSON만 출력한다.`;

export type VergeSummaryJson = {
  postTitle: string;
  lines: [string, string, string];
  takeaway: string;
};

function parseVergeSummaryJson(value: unknown): VergeSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.postTitle !== 'string' || !o.postTitle.trim()) return null;
  if (!Array.isArray(o.lines) || o.lines.length !== 3) return null;
  const lines = o.lines.map((x) => (typeof x === 'string' ? x.trim() : ''));
  if (lines.some((l) => l.length < 4)) return null;
  if (typeof o.takeaway !== 'string' || !o.takeaway.trim()) return null;
  return {
    postTitle: o.postTitle.trim(),
    lines: [lines[0]!, lines[1]!, lines[2]!],
    takeaway: o.takeaway.trim(),
  };
}

export async function summarizeVergeArticle(
  apiKey: string,
  title: string,
  bodyPlain: string
): Promise<{ ok: true; data: VergeSummaryJson } | { ok: false; error: string }> {
  const user = `원 제목: ${title}\n\n기사 본문(평문, RSS에서 HTML 제거):\n${bodyPlain}`;
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
              maxOutputTokens: 4096,
            },
          },
          { apiVersion }
        );
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        const parsed = tryParseJsonFromModelText(text);
        if (!parsed.ok) {
          lastErr = new Error('JSON parse failed');
          continue;
        }
        const data = parseVergeSummaryJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid Verge summary JSON');
          continue;
        }
        return { ok: true, data };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) continue;
        const classified = classifyGeminiFailure(e);
        if (
          classified.category === 'AUTH' ||
          classified.category === 'RATE_LIMIT' ||
          classified.category === 'SERVER'
        ) {
          return { ok: false, error: classified.userMessage };
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
