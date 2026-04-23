import { GoogleGenerativeAI } from '@google/generative-ai';
import { GEMINI_API_VERSION_CHAIN, GEMINI_GEEKNEWS_MODEL_CHAIN } from '@/lib/gemini-models';
import {
  classifyGeminiFailure,
  isGeminiModelNotFoundForFallback,
  tryParseJsonFromModelText,
} from '@/lib/gemini-prompt-analysis-engine';
import type { TranscriptResult } from '@/lib/youtube-sync/fetch-transcript';
import type { YoutubeVideoSnippet } from '@/lib/youtube-sync/fetch-video-snippet';
import {
  MIN_SYNDICATED_BODY_CHARS,
  MIN_YOUTUBE_METADATA_SUMMARY_CHARS,
  totalCharCount,
} from '@/lib/syndication-content-standards';

export type YoutubeSyndicationSource = 'MIT_OCW' | 'DEEPMIND';

const MAX_INPUT_CHARS = 100_000;

const MIT_SYSTEM = `너는 MIT OpenCourseWare 강의를 한국어로 정리하는 교육 에디터다.

입력은 해당 영상의 **자막 텍스트**(원어가 영어일 수 있음)와 영상 제목이다.

규칙:
- 톤은 정중하고 지적이며, 과장하지 않는다.
- 전문 용어는 한글 설명 뒤 괄호에 영어를 병기할 수 있다.
- 단순 bullet 나열이 아니라 **배경 → 핵심 강의 내용 → 앞으로의 학습·응용** 흐름으로 쓴다.
- 세 필드("backgroundContext", "summaryBody", "futureOutlook") 문자를 합쳐 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함)가 되도록 충분히 서술한다.
- 출력은 JSON 한 개만. 코드펜스·잡담 금지.

스키마 (각 값은 마크다운 헤더(#) 없이 평문·문단만):
- "postTitle": 문자열. 한 줄 한국어 제목(말머리 [MIT 연구] 등은 넣지 말 것 — UI에서 별도 배지 처리).
- "backgroundContext": 문자열. **배경** — 이 강의가 놓인 교과·문제의식·선수 지식 맥락. "\\n\\n"로 문단 구분.
- "summaryBody": 문자열. **핵심 정리** — 대학 강의 요약: 이론·개념, 수식·기호는 **의미**를 직관적으로 설명. "\\n\\n".
- "futureOutlook": 문자열. **향후 전망** — 이어서 볼 만한 주제·실습·응용, 시험·학습 팁 등. "\\n\\n".

자막이 영어면 내용을 한국어로 작성한다.`;

const DEEPMIND_SYSTEM = `너는 AI 산업을 다루는 한국어 테크 리포터다.

입력은 Google DeepMind 채널 영상의 **자막**(영어일 수 있음)과 제목이다.

규칙:
- **최신 기술 리포트** 스타일로 작성한다.
- 이번 발표·연구가 **AI 산업·생태계에 미칠 영향력**을 구체적으로 다룬다.
- 세 필드("backgroundContext", "summaryBody", "futureOutlook") 합계 **최소 ${MIN_SYNDICATED_BODY_CHARS}자**(공백 포함).
- 출력은 JSON 한 개만. 코드펜스·잡담 금지.

스키마 (마크다운 헤더 없이 평문):
- "postTitle": 문자열. 한 줄 한국어 제목(말머리 없이).
- "backgroundContext": 문자열. **배경** — 문제 정의·이전 연구·왜 지금인가. "\\n\\n".
- "summaryBody": 문자열. **핵심 정리** — 방법·실험·결과를 정확히. 자막이 영어면 한국어로. "\\n\\n".
- "futureOutlook": 문자열. **향후 전망** — 상용화·규제·경쟁 구도·후속 연구 가능성. "\\n\\n".

전문 용어는 필요 시 한글 뒤 괄호에 영어를 병기한다.`;

const MIT_METADATA_SYSTEM = `너는 MIT OpenCourseWare 강연 소개를 한국어로 쓰는 교육 에디터다.

**자막이 없다.** 입력은 YouTube Data API가 주는 **영상 제목·채널명·영상 설명(snippet)** 뿐이다. 강의 전체를 시청한 것이 아니므로, 추측으로 세부 내용을 단정하지 않는다.

규칙:
- 설명문에 나온 사실을 중심으로 **배경·개괄 소개·주의/한계(향후 확인 포인트)**를 나눠 쓴다.
- 세 필드 합계가 **최소 ${MIN_YOUTUBE_METADATA_SUMMARY_CHARS}자**(공백 포함)가 되도록 문장을 넉넉히 이어 쓴다 (입력이 빈약하면 솔직히 한계를 밝히되 분량은 채운다).
- 확실하지 않은 기술적 세부는 "영상에서 확인" 식으로 남긴다.
- 출력은 JSON 한 개만.

스키마 (마크다운 헤더 없이 평문):
- "postTitle": 문자열. 한 줄 한국어 제목.
- "backgroundContext": 문자열. **배경** — 채널·강좌 맥락, 설명에서 드러나는 주제. "\\n\\n".
- "summaryBody": 문자열. **핵심 정리** — 설명에 근거한 강연 소개; 자막 없음을 한 문장 언급 가능. "\\n\\n".
- "futureOutlook": 문자열. **향후 전망** — 시청자가 영상에서 확인할 체크리스트·후속 학습 방향. "\\n\\n".`;

const DEEPMIND_METADATA_SYSTEM = `너는 AI 산업을 다루는 한국어 테크 리포터다.

**자막이 없다.** 입력은 Google DeepMind 채널 영상의 **제목·채널명·YouTube 영상 설명**만이다.

규칙:
- 설명에 근거해 **배경·발표 개요·불확실성/후속 관전 포인트**를 나눈다.
- 세 필드 합계 **최소 ${MIN_YOUTUBE_METADATA_SUMMARY_CHARS}자**(공백 포함).
- 설명이 빈약하면 제목·브랜드 맥락을 명시하고, 단정하지 않은 채 상세는 원본 시청을 권한다.
- 출력은 JSON 한 개만.

스키마 (마크다운 헤더 없이 평문):
- "postTitle": 문자열. 한 줄 한국어 제목.
- "backgroundContext": 문자열. **배경**. "\\n\\n".
- "summaryBody": 문자열. **핵심 정리** — 설명 기반 개괄. "\\n\\n".
- "futureOutlook": 문자열. **향후 전망** — 업계 영향 가능성과 확인이 필요한 부분. "\\n\\n".`;

export type YoutubeSummaryJson = {
  postTitle: string;
  backgroundContext: string;
  summaryBody: string;
  futureOutlook: string;
};

export type YoutubeSummaryParseMode = 'transcript' | 'metadata';

function parseSummaryJson(value: unknown, mode: YoutubeSummaryParseMode): YoutubeSummaryJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  const postTitle = typeof o.postTitle === 'string' ? o.postTitle.trim() : '';
  const backgroundContext =
    typeof o.backgroundContext === 'string' ? o.backgroundContext.trim() : '';
  const summaryBody = typeof o.summaryBody === 'string' ? o.summaryBody.trim() : '';
  const futureOutlook = typeof o.futureOutlook === 'string' ? o.futureOutlook.trim() : '';
  if (postTitle.length < 4) return null;

  const minTotal =
    mode === 'transcript' ? MIN_SYNDICATED_BODY_CHARS : MIN_YOUTUBE_METADATA_SUMMARY_CHARS;
  if (totalCharCount([backgroundContext, summaryBody, futureOutlook]) < minTotal) return null;

  if (mode === 'transcript') {
    if (backgroundContext.length < 80 || summaryBody.length < 180 || futureOutlook.length < 60) {
      return null;
    }
  } else {
    if (backgroundContext.length < 40 || summaryBody.length < 80 || futureOutlook.length < 40) {
      return null;
    }
  }

  return { postTitle, backgroundContext, summaryBody, futureOutlook };
}

function buildUserMessage(rssTitle: string, tr: TranscriptResult): string {
  const clipped = tr.text.length > MAX_INPUT_CHARS ? tr.text.slice(0, MAX_INPUT_CHARS) : tr.text;
  const langNote = tr.isKoreanPrimary
    ? '자막 언어: 한국어 우선 트랙을 사용했습니다.'
    : `자막 언어: ${tr.lang} (한국어가 없어 이 트랙을 사용했습니다. 요약·번역은 한국어로.)`;
  return `영상 제목(RSS): ${rssTitle}\n\n${langNote}\n\n자막 본문:\n\n${clipped}`;
}

function buildMetadataUserMessage(rssTitle: string, snippet: YoutubeVideoSnippet): string {
  const desc =
    snippet.description.length > MAX_INPUT_CHARS
      ? snippet.description.slice(0, MAX_INPUT_CHARS)
      : snippet.description;
  const lines = [
    `피드·목록에서 본 제목: ${rssTitle}`,
    `API 제목: ${snippet.title || '(없음)'}`,
    `채널: ${snippet.channelTitle || '(없음)'}`,
    snippet.publishedAt ? `게시: ${snippet.publishedAt}` : null,
    '',
    'YouTube 영상 설명:',
    desc || '(설명 없음)',
  ].filter((x): x is string => x !== null && x !== undefined);
  return lines.join('\n');
}

async function runGeminiYoutubeSummaryPrompt(
  apiKey: string,
  prompt: string,
  parseMode: YoutubeSummaryParseMode,
): Promise<{ ok: true; data: YoutubeSummaryJson } | { ok: false; error: string }> {
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
        const data = parseSummaryJson(parsed.value, parseMode);
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

export async function summarizeYoutubeWithGemini(
  apiKey: string,
  source: YoutubeSyndicationSource,
  rssTitle: string,
  transcript: TranscriptResult,
): Promise<{ ok: true; data: YoutubeSummaryJson } | { ok: false; error: string }> {
  const system = source === 'MIT_OCW' ? MIT_SYSTEM : DEEPMIND_SYSTEM;
  const user = buildUserMessage(rssTitle, transcript);
  const prompt = `${system}\n\n---\n\n${user}`;
  return runGeminiYoutubeSummaryPrompt(apiKey, prompt, 'transcript');
}

/** 자막 없음 폴백 — 영상 설명(snippet)만으로 요약 */
export async function summarizeYoutubeFromVideoMetadata(
  apiKey: string,
  source: YoutubeSyndicationSource,
  rssTitle: string,
  snippet: YoutubeVideoSnippet,
): Promise<{ ok: true; data: YoutubeSummaryJson } | { ok: false; error: string }> {
  const system = source === 'MIT_OCW' ? MIT_METADATA_SYSTEM : DEEPMIND_METADATA_SYSTEM;
  const user = buildMetadataUserMessage(rssTitle, snippet);
  const prompt = `${system}\n\n---\n\n${user}`;
  return runGeminiYoutubeSummaryPrompt(apiKey, prompt, 'metadata');
}
