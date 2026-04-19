import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN } from '@/lib/gemini-models';
import { tryParseJsonFromModelText } from '@/lib/gemini-prompt-analysis-engine';

/** 요구사항: Gemini 1.5 Flash */
const GEEKNEWS_SUMMARY_MODEL = 'gemini-1.5-flash-latest';

/**
 * 참고 톤: `post/c5f8ed2f-902b-45e7-bb86-19fbe6bad46a` — [오픈소스 소개] 스타일 제목,
 * 도입 → 번호형 소제목(1. 2. …) 본문 → 가치/인사이트 → 기술·메타(선택).
 */
const SYSTEM = `너는 개발자·IT 독자를 위한 한국어 에디터다. 입력은 웹에서 추출한 기사 평문과 원 제목이다.

아래 JSON **한 개만** 출력하라. 마크다운 코드펜스·설명 문장 밖의 텍스트 금지.

스키마:
- "postTitle": 문자열. 반드시 "[GeekNews 요약]" 으로 시작한 뒤, 원문을 한 줄로 잘 요약한 제목을 붙여라. (예: "[GeekNews 요약] Zerobox — Codex 샌드박스를 단일 CLI로")
- "introduction": 문자열. 2~4문장 도입. 독자가 왜 읽어야 하는지·배경을 자연스럽게.
- "sections": 배열. 원문에 맞게 **최소 3개, 많으면 6개까지** 객체. 각 객체는 "title"(예: "1. 무엇인가", "2. 주요 기능")과 "content"(해당 절 전체 문단, 여러 문장 허용) 필수.
- "valueAndInsight": 문자열. "프로젝트의 가치"에 해당하는 절 — 왜 중요한지, 시사점, 실무에서 어떻게 쓰이는지.
- "techStackOrMeta": 문자열. 기술 스택·라이선스·저장소 등 메타가 있으면 bullet 형식으로, 없으면 빈 문자열 "".

JSON만 출력한다.`;

export type GeekNewsSection = { title: string; content: string };

export type GeekNewsArticleJson = {
  postTitle: string;
  introduction: string;
  sections: GeekNewsSection[];
  valueAndInsight: string;
  techStackOrMeta: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function parseArticleJson(value: unknown): GeekNewsArticleJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (!isNonEmptyString(o.postTitle)) return null;
  if (!isNonEmptyString(o.introduction)) return null;
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
  const tech =
    typeof o.techStackOrMeta === 'string' ? o.techStackOrMeta.trim() : '';
  return {
    postTitle: o.postTitle.trim(),
    introduction: o.introduction.trim(),
    sections,
    valueAndInsight: o.valueAndInsight.trim(),
    techStackOrMeta: tech,
  };
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
  for (const apiVersion of GEMINI_API_VERSION_CHAIN) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel(
        {
          model: GEEKNEWS_SUMMARY_MODEL,
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
        continue;
      }
      const data = parseArticleJson(parsed.value);
      if (!data) {
        lastErr = new Error('Invalid article JSON shape');
        continue;
      }
      console.log('[geeknews/summarize] Gemini 요약 완료', data.postTitle.slice(0, 72));
      return { ok: true, data };
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
