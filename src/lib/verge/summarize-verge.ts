import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import { MIN_SYNDICATED_BODY_CHARS, totalCharCount } from '@/lib/syndication-content-standards';

const SYSTEM = `너는 The Verge 스타일의 테크 저널리즘을 한국어로 옮기는 에디터다. 톤은 날카롭고 트렌디하며, 과장 없이 "왜 지금 이 소식이 중요한지"가 드러나게 쓴다.

입력은 RSS에서 추출한 기사 평문(HTML 제거됨)과 원 제목이다.

품질: 단순 3줄 요약이 아니라 **배경 설명**, **본문 분석**, **향후 전망**까지 서술한다.
아래 필드 문자 수 합계가 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함) 이상 되도록 깊게 쓴다.

아래 JSON **한 개만** 출력한다. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. "[The Verge]" 로 시작하고, 원문 헤드라인을 한국어 독자에게 맞게 다듬은 한 줄 제목.
- "backgroundContext": 문자열. **배경 설명** — 업계 맥락, 역사적 선행 사례, 왜 지금 논의되는지. 여러 문단 허용("\\n\\n").
- "analysisBody": 문자열. 핵심 분석 본문. 제품·정책·경쟁관계·사용자 영향 등을 논리적으로 전개. 여러 문단 허용("\\n\\n").
- "futureOutlook": 문자열. **향후 전망** — 규제, 경쟁 반응, 가능한 로드맵, 불확실성까지 서술.
- "takeaway": 문자열. 마지막 한 줄 시사점.

JSON만 출력한다.`;

export type VergeSummaryJson = {
  postTitle: string;
  backgroundContext: string;
  analysisBody: string;
  futureOutlook: string;
  takeaway: string;
};

function parseVergeSummaryJson(value: unknown): VergeSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const postTitle = typeof o.postTitle === 'string' ? o.postTitle.trim() : '';
  const backgroundContext =
    typeof o.backgroundContext === 'string' ? o.backgroundContext.trim() : '';
  const analysisBody = typeof o.analysisBody === 'string' ? o.analysisBody.trim() : '';
  const futureOutlook = typeof o.futureOutlook === 'string' ? o.futureOutlook.trim() : '';
  const takeaway = typeof o.takeaway === 'string' ? o.takeaway.trim() : '';
  if (
    postTitle.length < 8 ||
    backgroundContext.length < 40 ||
    analysisBody.length < 120 ||
    futureOutlook.length < 40 ||
    takeaway.length < 8
  ) {
    return null;
  }
  const merged: VergeSummaryJson = {
    postTitle,
    backgroundContext,
    analysisBody,
    futureOutlook,
    takeaway,
  };
  const sum = totalCharCount([
    merged.backgroundContext,
    merged.analysisBody,
    merged.futureOutlook,
    merged.takeaway,
  ]);
  if (sum < MIN_SYNDICATED_BODY_CHARS) return null;
  return merged;
}

export async function summarizeVergeArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
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
        if (classified.category === 'AUTH' || classified.category === 'RATE_LIMIT') {
          console.error('[verge/summarize] Gemini 호출 실패(중단)', {
            modelId,
            apiVersion,
            category: classified.category,
            evidence: classified.evidence,
            message: e instanceof Error ? e.message : String(e),
          });
          return { ok: false, error: classified.userMessage };
        }
        if (classified.category === 'SERVER') {
          console.warn('[verge/summarize] 일시 과부하(503 등) → 다음 모델·버전 시도', {
            modelId,
            apiVersion,
            evidence: classified.evidence,
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
