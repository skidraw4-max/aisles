'use server';

import { unstable_noStore as noStore } from 'next/cache';

/**
 * Gemini: `@google/generative-ai` — package.json 기준 최신 안내는 npm `0.24.1` (프로젝트와 동일한지 배포 시 확인).
 * 모델: Google AI Studio 할당량 기준 **Gemini 2.5 Flash** → API ID `gemini-2.5-flash`.
 * 연결만 검증하려면 `GEMINI_MINIMAL_SYSTEM=1` → 시스템 문구가 "너는 도우미야." 로 바뀜(기본은 정교한 분석 프롬프트).
 *
 * 스트리밍 UI는 `POST /api/posts/[id]/prompt-analysis-stream` + `@/lib/gemini-prompt-analysis-engine`.
 *
 * 이미지 역분석: `analyzeImage` — 업로드 이미지는 **생성 대상이 아니라 역분석용 참고 입력**만.
 * 모델 체인은 `@/lib/gemini-models`의 `GEMINI_IMAGE_MODEL_CHAIN`.
 * `systemInstruction` + 사용자 프롬프트로 JSON만 유도. 멀티모달+`responseMimeType: application/json`은 간헐 404가 있어 **미설정**.
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from '@google/generative-ai';
import sharp from 'sharp';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import {
  classifyGeminiFailure,
  executeGeminiPromptAnalysisWithApiKey,
  geminiFailureToResult,
  GEMINI_API_KEY_ENV_NAMES,
  logGeminiKeyEnvDiagnostics,
  missingApiKeyResult,
  readGeminiApiKeyFromEnv,
  tryParseJsonFromModelText,
  validateGeminiApiKeyShape,
  type AnalyzePromptErrorCode,
  type AnalyzePromptResult,
  type PromptAnalysis,
} from '@/lib/gemini-prompt-analysis-engine';
import { isPlainRecord, parseStoredPromptAnalysisJson } from '@/lib/prompt-analysis';
import { pickEstimatedPromptFromAnalysis } from '@/lib/gallery-image-analysis';
import { GEMINI_IMAGE_MODEL_CHAIN, GEMINI_MODEL_PRIMARY } from '@/lib/gemini-models';

export type { PromptAnalysis, AnalyzePromptErrorCode, AnalyzePromptResult };

/** 이미지 URL 또는 base64(선택 `mimeType`) — 서버에서만 Gemini로 전달 */
export type AnalyzeImageInput =
  | { imageUrl: string }
  | { imageBase64: string; mimeType?: string };

/** 역분석 결과 JSON 객체 — 키는 모델이 채움 */
export type AnalyzeImageResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; code: AnalyzePromptErrorCode };

/** 이미지 역분석 — `GEMINI_IMAGE_MODEL_CHAIN` 순서로 시도 (2.5 → 2 flash 폴백) */
const IMAGE_REVERSE_MODELS = GEMINI_IMAGE_MODEL_CHAIN;
const IMAGE_REVERSE_ATTEMPTS_PER_MODEL = 4;
const IMAGE_REVERSE_RETRY_BASE_MS = 700;
/** 원본 다운로드·디코드 상한 (리사이즈 전) */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** Gemini 분석용 리사이즈 — 가로 최대 px */
const GEMINI_IMAGE_MAX_WIDTH = 768;
const GEMINI_IMAGE_JPEG_QUALITY = 85;

/** 시스템: 역공학 역할 고정 — 이미지 생성 지시 금지 */
const IMAGE_REVERSE_SYSTEM_INSTRUCTION = `너는 세계 최고의 AI 이미지 역공학 전문가야. 이 이미지를 보고 원본 프롬프트를 역추적해서 텍스트로만 알려줘.

[역할 경계]
- 목적은 새 이미지를 만드는 것이 아니라, 이미 업로드된 이미지를 읽고 그에 대응하는 텍스트(추정 프롬프트·메타 설명)만 산출하는 것이다.
- 응답에 이미지 생성을 요청하거나, 생성 AI용 "만들어라" 류의 지시·도구 호출·바이너리 출력을 포함하지 마라.
- 최종 출력은 오직 하나의 JSON 객체이며, 마크다운 코드펜스·서두/맺음말 없이 JSON만 출력하라.`;

/**
 * 사용자 텍스트: 인라인 이미지는 참고 자료로만 명시 + UI가 기대하는 키만 허용하는 JSON 스키마 고정.
 * (Gallery 역분석 카드: estimatedPrompt, artStyle, lighting, composition, keywords)
 */
const IMAGE_REVERSE_USER_PROMPT = `첫 번째 콘텐츠 파트에 붙은 이미지는 **이미지를 새로 생성하기 위한 입력이 아니다**. 텍스트 분석·역추적을 위한 **참고 자료(읽기 전용)** 로만 사용하라.

반드시 아래 키만 포함하는 **단일 JSON 객체**만 출력하라. 키 이름을 바꾸거나 누락하지 마라. 값은 모두 UTF-8 문자열이거나, keywords만 문자열의 배열이다.

키 정의:
- "estimatedPrompt": 역추적한 원본에 가까운 생성용 프롬프트 한 덩어리(한국어 위주, 순수 텍스트).
- "artStyle": 화풍·미디엄·스타일 요약.
- "lighting": 조명·광질.
- "composition": 구도·앵글.
- "keywords": 주요 키워드 5~15개의 배열(각 원소는 짧은 문자열).

금지: JSON 바깥의 문장, \`\`\`json 래핑, 이미지 재생성·편집 지시, 위 키 이외의 최상위 필드.`;

function stripDataUrlBase64(raw: string): { mimeType: string; base64: string } | null {
  const t = raw.trim();
  const m = /^data:([^;]+);base64,([\s\S]+)$/i.exec(t);
  if (!m) return null;
  return { mimeType: m[1].trim(), base64: m[2].replace(/\s/g, '') };
}

/**
 * URL·base64 입력을 디코드한 원시 바이너리로만 반환 (리사이즈·포맷 변환은 호출부에서 sharp 처리).
 */
async function resolveImageRawBuffer(
  input: AnalyzeImageInput,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; code: AnalyzePromptErrorCode }> {
  if ('imageBase64' in input && typeof input.imageBase64 === 'string') {
    let base64 = input.imageBase64.trim();
    const dataUrl = stripDataUrlBase64(base64);
    if (dataUrl) {
      base64 = dataUrl.base64;
    }
    if (!base64) {
      return { ok: false, error: '이미지 데이터가 비어 있습니다.', code: 'VALIDATION' };
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return { ok: false, error: '이미지 데이터(base64) 형식이 올바르지 않습니다.', code: 'VALIDATION' };
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: '이미지 크기가 너무 큽니다. 더 작은 이미지를 사용해 주세요.',
        code: 'VALIDATION',
      };
    }
    return { ok: true, buffer };
  }

  if ('imageUrl' in input && typeof input.imageUrl === 'string') {
    const urlStr = input.imageUrl.trim();
    if (!urlStr) {
      return { ok: false, error: '이미지 URL이 비어 있습니다.', code: 'VALIDATION' };
    }

    const dataUrl = stripDataUrlBase64(urlStr);
    if (dataUrl) {
      let buffer: Buffer;
      try {
        buffer = Buffer.from(dataUrl.base64, 'base64');
      } catch {
        return { ok: false, error: 'data URL 이미지를 디코드할 수 없습니다.', code: 'VALIDATION' };
      }
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, error: '이미지 크기가 너무 큽니다.', code: 'VALIDATION' };
      }
      return { ok: true, buffer };
    }

    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return { ok: false, error: '올바른 이미지 URL이 아닙니다.', code: 'VALIDATION' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'http(s) URL만 지원합니다.', code: 'VALIDATION' };
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const res = await fetch(urlStr, {
        signal: ac.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'AIsle-image-reverse/1.0' },
      });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, error: '이미지를 불러오지 못했습니다.', code: 'API_ERROR' };
      }
      const ct = res.headers.get('content-type') || '';
      if (!ct.toLowerCase().startsWith('image/')) {
        return {
          ok: false,
          error: 'URL이 image/* 콘텐츠를 가리키지 않습니다.',
          code: 'VALIDATION',
        };
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        return { ok: false, error: '이미지 크기가 너무 큽니다.', code: 'VALIDATION' };
      }
      return { ok: true, buffer: Buffer.from(buf) };
    } catch (e) {
      clearTimeout(timer);
      const name = e instanceof Error ? e.name : '';
      if (name === 'AbortError') {
        return { ok: false, error: '이미지 다운로드 시간이 초과되었습니다.', code: 'TIMEOUT' };
      }
      return { ok: false, error: '이미지를 불러오지 못했습니다.', code: 'API_ERROR' };
    }
  }

  return {
    ok: false,
    error: 'imageUrl 또는 imageBase64 중 하나를 지정해 주세요.',
    code: 'VALIDATION',
  };
}

/** 가로 최대 768px, JPEG로 통일 — Gemini 인라인 전송용 base64 */
async function resizeToGeminiJpegBase64(
  input: Buffer,
): Promise<
  { ok: true; data: string } | { ok: false; error: string; code: AnalyzePromptErrorCode }
> {
  try {
    const out = await sharp(input)
      .rotate()
      .resize({
        width: GEMINI_IMAGE_MAX_WIDTH,
        withoutEnlargement: true,
      })
      .jpeg({
        quality: GEMINI_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    return { ok: true, data: out.toString('base64') };
  } catch (e) {
    console.error('[analyzeImage] sharp resize/jpeg failed', e);
    return {
      ok: false,
      error: '이미지를 처리할 수 없습니다. 지원되는 이미지 형식인지 확인해 주세요.',
      code: 'VALIDATION',
    };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 응답 블록·API 키 오류 등 — 재시도해도 의미 없음 */
function shouldStopImageRetries(e: unknown): boolean {
  if (e instanceof GoogleGenerativeAIResponseError) {
    return true;
  }
  if (e instanceof GoogleGenerativeAIFetchError) {
    const s = e.status ?? 0;
    if (s === 400 || s === 401 || s === 403) {
      return true;
    }
  }
  return classifyGeminiFailure(e).category === 'AUTH';
}

function isTransientImageApiError(e: unknown): boolean {
  if (e instanceof GoogleGenerativeAIResponseError) {
    return false;
  }
  if (e instanceof GoogleGenerativeAIFetchError) {
    const s = e.status ?? 0;
    /** 404 포함: Google 쪽 간헐적 404는 다음 모델로 바로 넘기지 말고 동일 모델에서 재시도하는 편이 안전 */
    return s === 404 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504;
  }
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up')
  ) {
    return true;
  }
  const c = classifyGeminiFailure(e).category;
  return c === 'RATE_LIMIT' || c === 'SERVER';
}

function imageErrorFromGeminiFailure(err: unknown): AnalyzeImageResult {
  const r = geminiFailureToResult(err);
  if (!r.ok) {
    return { ok: false, error: r.error, code: r.code };
  }
  return { ok: false, error: '이미지 분석 중 오류가 발생했습니다.', code: 'API_ERROR' };
}

/**
 * 이미지 역분석 — 추정 프롬프트·화풍·조명·구도·키워드를 JSON으로 반환.
 * API 키는 서버 전용. 원본은 서버에서만 fetch/디코드 후 sharp로 리사이즈·JPEG·base64 인라인 전달.
 */
export async function analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageResult> {
  noStore();

  const auth = await requireUserForPromptAnalysis();
  if (!auth.ok) {
    return {
      ok: false,
      error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.',
      code: 'UNAUTHENTICATED',
    };
  }

  const resolvedKey = readGeminiApiKeyFromEnv();
  if (!resolvedKey.ok) {
    logGeminiKeyEnvDiagnostics();
    const miss = missingApiKeyResult();
    if (!miss.ok) {
      return { ok: false, error: miss.error, code: miss.code };
    }
    return { ok: false, error: '서버 설정 오류입니다.', code: 'API_ERROR' };
  }

  const apiKey = resolvedKey.key;
  const keyCheck = validateGeminiApiKeyShape(apiKey);
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.message, code: 'INVALID_API_KEY' };
  }

  const raw = await resolveImageRawBuffer(input);
  if (!raw.ok) {
    return raw;
  }

  const optimized = await resizeToGeminiJpegBase64(raw.buffer);
  if (!optimized.ok) {
    return optimized;
  }

  let lastFailure: unknown = null;

  modelLoop: for (const modelId of IMAGE_REVERSE_MODELS) {
    for (let attempt = 0; attempt < IMAGE_REVERSE_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelId,
          systemInstruction: IMAGE_REVERSE_SYSTEM_INSTRUCTION,
          generationConfig: {
            temperature: 0.2,
            // 멀티모달(이미지)+application/json 조합이 일부 키/엔드포인트에서 404·실패를 유발할 수 있어 생략.
            // 스키마는 사용자 프롬프트로 고정하고 `tryParseJsonFromModelText`로 파싱.
          },
        });

        // Part[]: 이미지는 참고용 inlineData — MIME은 JPEG 바이트와 일치. data는 접두어 없는 base64.
        // @see https://ai.google.dev/api/rest/v1beta/Content#Part
        const result = await model.generateContent([
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: optimized.data,
            },
          },
          { text: IMAGE_REVERSE_USER_PROMPT },
        ]);

        let text: string;
        try {
          text = result.response.text().trim();
        } catch (textErr) {
          console.error('[analyzeImage] response.text() error', { modelId, attempt, textErr });
          lastFailure = textErr;
          if (textErr instanceof GoogleGenerativeAIResponseError) {
            return imageErrorFromGeminiFailure(textErr);
          }
          throw textErr instanceof Error ? textErr : new Error(String(textErr));
        }

        const parsed = tryParseJsonFromModelText(text);
        if (!parsed.ok || !isPlainRecord(parsed.value)) {
          return {
            ok: false,
            error: '모델 응답을 JSON으로 해석할 수 없습니다.',
            code: 'INVALID_JSON',
          };
        }

        return { ok: true, data: parsed.value };
      } catch (e) {
        lastFailure = e;
        console.error('[analyzeImage] attempt failed', { modelId, attempt, e });
        if (shouldStopImageRetries(e)) {
          return imageErrorFromGeminiFailure(e);
        }
        if (isTransientImageApiError(e) && attempt < IMAGE_REVERSE_ATTEMPTS_PER_MODEL - 1) {
          const jitter = Math.floor(Math.random() * 350);
          await delay(IMAGE_REVERSE_RETRY_BASE_MS * 2 ** attempt + jitter);
          continue;
        }
        const hasAnotherModel = modelId !== IMAGE_REVERSE_MODELS[IMAGE_REVERSE_MODELS.length - 1];
        if (hasAnotherModel) {
          continue modelLoop;
        }
        return imageErrorFromGeminiFailure(e);
      }
    }
  }

  return imageErrorFromGeminiFailure(lastFailure ?? new Error('Gemini 이미지 분석 실패'));
}

/**
 * 갤러리 포스트 이미지 역분석 후 `Post.aiReversePrompt`·`aiImageAnalysis`에 저장해 재방문 시 API를 생략합니다.
 */
export async function analyzeImageForGalleryPost(
  postId: string,
  input: AnalyzeImageInput,
): Promise<AnalyzeImageResult> {
  const res = await analyzeImage(input);
  if (!res.ok) return res;

  const estimated = pickEstimatedPromptFromAnalysis(res.data);
  try {
    await prisma.post.update({
      where: { id: postId },
      data: {
        aiReversePrompt: estimated || null,
        aiImageAnalysis: res.data as Prisma.InputJsonValue,
      },
    });
  } catch (e) {
    console.error('[analyzeImageForGalleryPost] prisma update failed', e);
  }

  return res;
}

async function loadCachedPromptAnalysisForPost(
  postId: string,
  expectedHash: string,
): Promise<PromptAnalysis | null> {
  const row = await prisma.aiMetadata.findUnique({
    where: { postId },
    select: { promptAnalysis: true, promptAnalysisPromptHash: true },
  });
  if (row?.promptAnalysisPromptHash !== expectedHash || row.promptAnalysis == null) {
    return null;
  }
  return parseStoredPromptAnalysisJson(row.promptAnalysis);
}

async function requireUserForPromptAnalysis(): Promise<{ ok: true } | { ok: false }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false };
  return { ok: true };
}

/**
 * Gemini만 호출(캐시·세션 검증 없음). 서버 액션·백그라운드 작업에서 공통 사용.
 * @param trimmed — 공백 제거된 비빈 문자열
 */
export async function executeGeminiPromptAnalysis(trimmed: string): Promise<AnalyzePromptResult> {
  const resolved = readGeminiApiKeyFromEnv();
  if (!resolved.ok) {
    console.error(
      '[executeGeminiPromptAnalysis] Missing API Key (server). Checked env names:',
      GEMINI_API_KEY_ENV_NAMES.join(', '),
    );
    logGeminiKeyEnvDiagnostics();
    return missingApiKeyResult();
  }

  const apiKey = resolved.key;

  const keyCheck = validateGeminiApiKeyShape(apiKey);
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.message, code: 'INVALID_API_KEY' };
  }

  if (process.env.NODE_ENV === 'development') {
    console.info(
      `[executeGeminiPromptAnalysis] API key OK (length=${apiKey.length}, from=${resolved.source}), model="${GEMINI_MODEL_PRIMARY}", minimalSystem=${process.env.GEMINI_MINIMAL_SYSTEM === '1'}`,
    );
  }

  return executeGeminiPromptAnalysisWithApiKey(trimmed, apiKey);
}

/**
 * Gemini만 호출(캐시 없음). 텍스트 분석 모델은 `@/lib/gemini-models`의 primary·fallback과 동일 체인.
 */
export async function analyzePrompt(userPrompt: string): Promise<AnalyzePromptResult> {
  noStore();

  const trimmed = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const auth = await requireUserForPromptAnalysis();
  if (!auth.ok) {
    return {
      ok: false,
      error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.',
      code: 'UNAUTHENTICATED',
    };
  }

  return executeGeminiPromptAnalysis(trimmed);
}

/**
 * 레시피 상세용: DB에 동일 프롬프트 해시의 분석이 있으면 **항상** DB만 사용하고 Gemini를 호출하지 않음(비용·중복 방지).
 */
export async function analyzePostPromptAnalysis(
  postId: string,
  promptText: string,
): Promise<AnalyzePromptResult> {
  noStore();

  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  const logPrefix = `[analyzePostPromptAnalysis] postId=${postId}`;
  console.log(`${logPrefix} invoked`, {
    promptLength: trimmed.length,
  });

  if (!trimmed) {
    console.log(`${logPrefix} abort EMPTY_PROMPT`);
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const auth = await requireUserForPromptAnalysis();
  if (!auth.ok) {
    console.log(`${logPrefix} abort UNAUTHENTICATED`);
    return {
      ok: false,
      error: 'AI 분석은 로그인한 회원만 이용할 수 있습니다.',
      code: 'UNAUTHENTICATED',
    };
  }

  const hash = fingerprintPrompt(trimmed);

  try {
    const cached = await loadCachedPromptAnalysisForPost(postId, hash);
    if (cached) {
      console.log(`${logPrefix} cache hit (no Gemini)`, { hashPrefix: hash.slice(0, 12) });
      return { ok: true, data: cached };
    }

    const keyResolved = readGeminiApiKeyFromEnv();
    if (!keyResolved.ok) {
      const stale = await loadCachedPromptAnalysisForPost(postId, hash);
      if (stale) {
        console.warn(
          `${logPrefix} Gemini API key missing; returning DB cache only`,
        );
        return {
          ok: true,
          data: stale,
          notice:
            '서버에 Gemini API 키가 설정되어 있지 않아 원격으로 새로 분석하지 못했습니다. 이전에 저장된 분석 결과를 그대로 보여 드립니다. 새 분석을 받으려면 호스팅 환경 변수에 GOOGLE_GENERATIVE_AI_API_KEY(또는 GEMINI_API_KEY)를 넣고 재배포해 주세요.',
        };
      }
      console.error(
        '[analyzePostPromptAnalysis] Missing API Key (server). Checked env names:',
        GEMINI_API_KEY_ENV_NAMES.join(', '),
      );
      logGeminiKeyEnvDiagnostics();
      return missingApiKeyResult();
    }

    const res = await executeGeminiPromptAnalysis(trimmed);
    if (!res.ok) {
      console.log(`${logPrefix} executeGemini finished`, { ok: false, code: res.code });
      return res;
    }

    await prisma.aiMetadata.upsert({
      where: { postId },
      create: {
        postId,
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
      update: {
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
    });

    console.log(`${logPrefix} success persisted`, { hashPrefix: hash.slice(0, 12) });
    return res;
  } catch (e) {
    console.error(`${logPrefix} unexpected error`, e);
    return {
      ok: false,
      error: '프롬프트 분석 저장 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      code: 'API_ERROR',
    };
  }
}

/**
 * LAB 글 등록 직후 백그라운드 실행: DB에 동일 해시 분석이 이미 있으면 Gemini를 호출하지 않음.
 */
export async function runPostPromptAnalysisJob(postId: string, promptText: string): Promise<void> {
  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  console.log('[runPostPromptAnalysisJob] start', { postId, promptLength: trimmed.length });
  if (!trimmed) {
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: {
          promptAnalysisStatus: 'FAILED',
          promptAnalysis: Prisma.DbNull,
          promptAnalysisPromptHash: null,
        },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] empty prompt, metadata update failed', postId, e);
    }
    return;
  }

  const hash = fingerprintPrompt(trimmed);
  const cached = await loadCachedPromptAnalysisForPost(postId, hash);
  if (cached) {
    console.log('[runPostPromptAnalysisJob] skip Gemini: already in DB', {
      postId,
      hashPrefix: hash.slice(0, 12),
    });
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: { promptAnalysisStatus: 'READY' },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] READY status-only update failed', postId, e);
    }
    return;
  }

  const res = await executeGeminiPromptAnalysis(trimmed);

  if (!res.ok) {
    console.warn('[runPostPromptAnalysisJob] Gemini failed', { postId, code: res.code });
    try {
      await prisma.aiMetadata.update({
        where: { postId },
        data: {
          promptAnalysisStatus: 'FAILED',
          promptAnalysis: Prisma.DbNull,
          promptAnalysisPromptHash: null,
        },
      });
    } catch (e) {
      console.error('[runPostPromptAnalysisJob] FAILED update failed', postId, e);
    }
    return;
  }

  try {
    await prisma.aiMetadata.update({
      where: { postId },
      data: {
        promptAnalysis: res.data as object,
        promptAnalysisPromptHash: hash,
        promptAnalysisStatus: 'READY',
      },
    });
    console.log('[runPostPromptAnalysisJob] success', { postId, hashPrefix: hash.slice(0, 12) });
  } catch (e) {
    console.error('[runPostPromptAnalysisJob] READY update failed', postId, e);
  }
}
