import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import type { TranscriptResult } from '@/lib/youtube-sync/fetch-transcript';

export type YoutubeSyndicationSource = 'MIT_OCW' | 'DEEPMIND';

const MAX_INPUT_CHARS = 100_000;

const MIT_SYSTEM = `너는 MIT OpenCourseWare 강의를 한국어로 정리하는 교육 에디터다.

입력은 해당 영상의 **자막 텍스트**(원어가 영어일 수 있음)와 영상 제목이다.

규칙:
- 톤은 정중하고 지적이며, 과장하지 않는다.
- 전문 용어는 한글 설명 뒤 괄호에 영어를 병기할 수 있다.
- 출력은 JSON 한 개만. 코드펜스·잡담 금지.

스키마:
- "postTitle": 문자열. 한 줄 한국어 제목(말머리 [MIT 연구] 등은 넣지 말 것 — UI에서 별도 배지 처리).
- "summaryBody": 문자열. **대학 강의 요약본** 스타일. 다음을 포함한다:
  - 강의가 다루는 핵심 이론·개념
  - 등장하는 수식·기호가 있다면 그 **의미**를 직관적으로 설명 (암기식 나열 지양)
  - 정리·결론
  - 문단 구분은 "\\n\\n"

자막이 영어면 내용을 한국어로 작성한다.`;

const DEEPMIND_SYSTEM = `너는 AI 산업을 다루는 한국어 테크 리포터다.

입력은 Google DeepMind 채널 영상의 **자막**(영어일 수 있음)과 제목이다.

규칙:
- **최신 기술 리포트** 스타일로 작성한다.
- 이번 발표·연구가 **AI 산업·생태계에 미칠 영향력**을 구체적으로 강조한다.
- 톤은 정중하고 지적이다.
- 출력은 JSON 한 개만. 코드펜스·잡담 금지.

스키마:
- "postTitle": 문자열. 한 줄 한국어 제목(말머리 없이).
- "summaryBody": 문자열. 본문. 문단 구분 "\\n\\n". 자막이 영어면 한국어로 작성.

전문 용어는 필요 시 한글 뒤 괄호에 영어를 병기한다.`;

export type YoutubeSummaryJson = {
  postTitle: string;
  summaryBody: string;
};

function parseSummaryJson(value: unknown): YoutubeSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const postTitle = typeof o.postTitle === 'string' ? o.postTitle.trim() : '';
  const summaryBody = typeof o.summaryBody === 'string' ? o.summaryBody.trim() : '';
  if (postTitle.length < 4 || summaryBody.length < 120) return null;
  return { postTitle, summaryBody };
}

function buildUserMessage(
  rssTitle: string,
  tr: TranscriptResult,
): string {
  const clipped = tr.text.length > MAX_INPUT_CHARS ? tr.text.slice(0, MAX_INPUT_CHARS) : tr.text;
  const langNote = tr.isKoreanPrimary
    ? '자막 언어: 한국어 우선 트랙을 사용했습니다.'
    : `자막 언어: ${tr.lang} (한국어가 없어 이 트랙을 사용했습니다. 요약·번역은 한국어로.)`;
  return `영상 제목(RSS): ${rssTitle}\n\n${langNote}\n\n자막 본문:\n\n${clipped}`;
}

export async function summarizeYoutubeWithGemini(
  apiKey: string,
  source: YoutubeSyndicationSource,
  rssTitle: string,
  transcript: TranscriptResult,
): Promise<{ ok: true; data: YoutubeSummaryJson } | { ok: false; error: string }> {
  const system = source === 'MIT_OCW' ? MIT_SYSTEM : DEEPMIND_SYSTEM;
  const user = buildUserMessage(rssTitle, transcript);
  const prompt = `${system}\n\n---\n\n${user}`;

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
        const data = parseSummaryJson(parsed.value);
        if (!data) {
          lastErr = new Error('Invalid YouTube summary JSON');
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
          console.warn('[youtube-sync/summarize] 일시 과부하 → 다음 모델·버전', { modelId, apiVersion });
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
