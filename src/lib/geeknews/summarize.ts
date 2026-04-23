import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GEMINI_API_VERSION_CHAIN,
  GEMINI_GEEKNEWS_MODEL_CHAIN,
} from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import {
  MIN_SYNDICATED_BODY_CHARS,
  totalCharCount,
} from '@/lib/syndication-content-standards';

/**
 * 참고 톤: `post/c5f8ed2f-902b-45e7-bb86-19fbe6bad46a` — [오픈소스 소개] 스타일 제목,
 * 도입 → 번호형 소제목(1. 2. …) 본문 → 가치/인사이트 → 기술·메타(선택).
 */
const SYSTEM = `너는 개발자·IT 독자를 위한 한국어 에디터다. 입력은 웹에서 추출한 기사 평문과 원 제목이다.

품질: 단순 나열 요약이 아니라 **배경 맥락**과 **향후 전망**까지 서술해 글이 깊게 읽히게 한다.
아래 필드 문자 수를 합쳐 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함, 한국어 기준) 이상 되도록 각 항목을 넉넉히 쓴다.

아래 JSON **한 개만** 출력하라. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. 반드시 "[GeekNews 요약]" 으로 시작한 뒤, 원문을 한 줄로 잘 요약한 제목을 붙여라. (예: "[GeekNews 요약] Zerobox — Codex 샌드박스를 단일 CLI로")
- "introduction": 문자열. 2~5문장 도입. 독자가 왜 읽어야 하는지·핵심 쟁점을 자연스럽게.
- "backgroundContext": 문자열. **배경 설명** — 이 소식이 나온 산업·기술·역사적 맥락, 선행 사례, 왜 지금 주목되는지. 여러 문단 허용("\\n\\n").
- "sections": 배열. 원문에 맞게 **최소 3개, 많으면 6개까지** 객체. 각 객체는 "title"(예: "1. 무엇인가", "2. 주요 기능")과 "content"(해당 절 전체 문단, 여러 문장·충분한 분량) 필수.
- "valueAndInsight": 문자열. 가치·시사점·실무 영향 — 왜 중요한지, 실무에서 어떻게 쓰이는지 깊게.
- "futureOutlook": 문자열. **향후 전망** — 규제·경쟁 구도, 로드맵 추정, 리스크와 기회 등 앞으로의 변수. 여러 문단 허용("\\n\\n").
- "techStackOrMeta": 문자열. 기술 스택·라이선스·저장소 등 메타가 있으면 bullet 형식으로, 없으면 빈 문자열 "".

JSON만 출력한다.`;

export type GeekNewsSection = { title: string; content: string };

export type GeekNewsArticleJson = {
  postTitle: string;
  introduction: string;
  /** 배경 설명 — 산업·역사 맥락 */
  backgroundContext: string;
  sections: GeekNewsSection[];
  valueAndInsight: string;
  /** 향후 전망 */
  futureOutlook: string;
  techStackOrMeta: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Hacker News 요약 등 동일 JSON 스키마 재사용 */
export function parseGeekNewsArticleJson(value: unknown): GeekNewsArticleJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (!isNonEmptyString(o.postTitle)) return null;
  if (!isNonEmptyString(o.introduction)) return null;
  if (!isNonEmptyString(o.backgroundContext)) return null;
  const backgroundContext = o.backgroundContext.trim();
  if (!Array.isArray(o.sections) || o.sections.length < 3) return null;
  const sections: GeekNewsSection[] = [];
  for (const s of o.sections.slice(0, 8)) {
    if (typeof s !== 'object' || s === null) return null;
    const r = s as Record<string, unknown>;
    if (!isNonEmptyString(r.title) || !isNonEmptyString(r.content)) return null;
    sections.push({ title: r.title.trim(), content: r.content.trim() });
  }
  if (sections.length < 3) return null;
  if (!isNonEmptyString(o.valueAndInsight)) return null;
  if (!isNonEmptyString(o.futureOutlook)) return null;
  const futureOutlook = o.futureOutlook.trim();
  const tech =
    typeof o.techStackOrMeta === 'string' ? o.techStackOrMeta.trim() : '';
  const merged: GeekNewsArticleJson = {
    postTitle: o.postTitle.trim(),
    introduction: o.introduction.trim(),
    backgroundContext,
    sections,
    valueAndInsight: o.valueAndInsight.trim(),
    futureOutlook,
    techStackOrMeta: tech,
  };
  const sum = totalCharCount([
    merged.introduction,
    merged.backgroundContext,
    merged.valueAndInsight,
    merged.futureOutlook,
    merged.techStackOrMeta,
    ...sections.map((s) => `${s.title}${s.content}`),
  ]);
  if (sum < MIN_SYNDICATED_BODY_CHARS) return null;
  return merged;
}

export async function summarizeGeekNewsArticle(
  apiKey: string,
  title: string,
  bodyPlain: string,
): Promise<{ ok: true; data: GeekNewsArticleJson } | { ok: false; error: string }> {
  const user = `GeekNews 목록 제목: ${title}\n\n원문 본문(평문):\n${bodyPlain}`;
  /** v1 `generateContent`는 `systemInstruction` 필드를 거부함 → 본문에 합쳐 전달 */
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
          console.warn('[geeknews/summarize] JSON 파싱 실패 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        const data = parseGeekNewsArticleJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid article JSON shape');
          console.warn('[geeknews/summarize] 스키마 불일치 → 다음 후보', { modelId, apiVersion });
          continue;
        }
        console.log('[geeknews/summarize] Gemini 요약 완료', {
          modelId,
          apiVersion,
          title: data.postTitle.slice(0, 72),
        });
        return { ok: true, data };
      } catch (e) {
        lastErr = e;
        if (isGeminiModelNotFoundForFallback(e)) {
          console.warn('[geeknews/summarize] 모델·API 경로 불가 → 다음 후보', {
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
          console.warn('[geeknews/summarize] 일시 과부하(503 등) → 다음 모델·버전 시도', {
            modelId,
            apiVersion,
          });
          continue;
        }
        console.warn('[geeknews/summarize] 일시 오류 → 다음 후보', {
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
