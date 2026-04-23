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

const SYSTEM = `너는 MIT News 수준의 학술·연구 뉴스를 한국어 **중학생도 이해할 수 있는 난이도**로 풀어 쓰는 과학 저널리스트다.

입력은 기사 본문 평문(HTML 제거)과 원 제목이다.

작성 규칙:
- 어려운 전문 용어·외래어는 **한글 설명 뒤 괄호에 영어 원어를 병기**한다. 예: 대규모 언어 모델(large language model, LLM), 정답 추론(chain-of-thought reasoning)
- 과장 없이, 비유는 정확할 때만 사용한다.
- 출력에 이미지·로고 URL, 마크다운 이미지 문법(\`![...](...)\`)을 넣지 않는다.
- **배경 설명**, 본문 요약, **향후 전망**을 모두 채워, 세 필드 문자 합계가 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함) 이상 되도록 분량을 확보한다.

아래 JSON **한 개만** 출력한다. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. **반드시 "[MIT 연구]"로 시작**한다. 그 뒤에 이번 연구·기사를 한 줄로 요약한 한국어 제목을 붙인다.
- "backgroundContext": 문자열. **배경 설명** — 선행 연구, 연구팀·기관 맥락, 이 문제를 다루는 이유. "\\n\\n" 문단 구분.
- "easySummary": 문자열. 핵심을 중학생 눈높이로 설명한다. "\\n\\n" 문단 구분.
- "futureImpact": 문자열. **이 기술·연구가 바꿀 미래**·한계·다음 단계 연구.

JSON만 출력한다.`;

export type MitNewsSummaryJson = {
  postTitle: string;
  backgroundContext: string;
  easySummary: string;
  futureImpact: string;
};

function parseMitNewsSummaryJson(value: unknown): MitNewsSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const postTitle = typeof o.postTitle === 'string' ? o.postTitle.trim() : '';
  const backgroundContext =
    typeof o.backgroundContext === 'string' ? o.backgroundContext.trim() : '';
  const easySummary = typeof o.easySummary === 'string' ? o.easySummary.trim() : '';
  const futureImpact = typeof o.futureImpact === 'string' ? o.futureImpact.trim() : '';
  if (!postTitle.startsWith('[MIT 연구]') || postTitle.length < 12) return null;
  if (backgroundContext.length < 80 || easySummary.length < 80 || futureImpact.length < 60) {
    return null;
  }
  const merged: MitNewsSummaryJson = { postTitle, backgroundContext, easySummary, futureImpact };
  if (totalCharCount([backgroundContext, easySummary, futureImpact]) < MIN_SYNDICATED_BODY_CHARS) {
    return null;
  }
  return merged;
}

const MAX_BODY_CHARS = 120_000;

export async function summarizeMitNewsArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
): Promise<{ ok: true; data: MitNewsSummaryJson } | { ok: false; error: string }> {
  const clipped = bodyPlain.length > MAX_BODY_CHARS ? bodyPlain.slice(0, MAX_BODY_CHARS) : bodyPlain;
  const user = `원 제목: ${title}\n\n기사 본문(평문):\n\n${clipped}`;
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
        const data = parseMitNewsSummaryJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid MIT News summary JSON');
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
          console.warn('[mit-news/summarize] 일시 과부하 → 다음 모델·버전', {
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
