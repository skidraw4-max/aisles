'use server';

/**
 * Gemini: `@google/generative-ai` — package.json 기준 최신 안내는 npm `0.24.1` (프로젝트와 동일한지 배포 시 확인).
 * 모델: Google AI Studio 할당량 기준 **Gemini 2.5 Flash** → API ID `gemini-2.5-flash`.
 * 연결만 검증하려면 `GEMINI_MINIMAL_SYSTEM=1` → 시스템 문구가 "너는 도우미야." 로 바뀜(기본은 정교한 분석 프롬프트).
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from '@google/generative-ai';
import { prisma } from '@/lib/prisma';
import { fingerprintPrompt } from '@/lib/prompt-analysis-fingerprint';
import {
  isPlainRecord,
  normalizePromptAnalysis,
  parseStoredPromptAnalysisJson,
  type PromptAnalysis,
} from '@/lib/prompt-analysis';

export type { PromptAnalysis };

/** Vercel/호스팅에서 이름이 다르게 등록된 경우 대비 (런타임 동적 조회로 빌드 시 고정 치환 완화) */
const GEMINI_API_KEY_ENV_NAMES = [
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_AI_API_KEY',
] as const;

function readGeminiApiKeyFromEnv():
  | { ok: true; key: string; source: (typeof GEMINI_API_KEY_ENV_NAMES)[number] }
  | { ok: false } {
  for (const name of GEMINI_API_KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed) {
      return { ok: true, key: trimmed, source: name };
    }
  }
  return { ok: false };
}

const MINIMAL_SYSTEM_INSTRUCTION = '너는 도우미야.';

const ANALYSIS_SYSTEM_INSTRUCTION = `You are a senior creative director and prompt engineer specialized in visual media (illustration, photography, 3D, film frames, concept art).

CRITICAL — OUTPUT FORMAT (must follow exactly):
- Respond with PURE JSON ONLY: a single JSON object, RFC 8259 compliant.
- The first non-whitespace character MUST be "{" and the last MUST be "}".
- Do NOT wrap in markdown code fences (no \`\`\`json). Do NOT add any prose, headings, or commentary before or after the JSON.
- Do NOT use trailing commas. Escape double quotes inside string values properly.

CRITICAL — LANGUAGE (Korean UI):
- Write the string values for "structure", "style", "lighting", and "composition" **entirely in natural Korean** (한국어 문장·구어체 가능). The user's input may be any language; always explain your analysis in Korean.
- For unavoidable specialist terms, use Korean first and optional English in parentheses, e.g. "림라이트(rim light)".
- "recommendedKeywords": each entry must be **Korean-first** (한글 단어·짧은 구). You may append a short English technical token in parentheses only when it is standard in generative-AI prompts (e.g. "시네마틱 조명(cinematic lighting)"). 5–12 items, no duplicates, no empty strings.

The user will send ONE prompt in natural language (any language). Infer intent even if the prompt is short or vague.

Your task: analyze that prompt and output EXACTLY one JSON object with these keys only:
- "structure" (string): subject hierarchy, focal points, foreground/midground/background, props, negative space, level of detail — concise, **in Korean**, specific to the user's prompt.
- "style" (string): art direction, era, medium, texture, color palette tendencies, references — **in Korean**, grounded in what the prompt implies.
- "lighting" (string): light quality, direction, time of day, contrast, shadows, atmosphere — **in Korean**, only what fits the prompt.
- "composition" (string): framing, camera angle, lens feel, rule of thirds, symmetry, leading lines — **in Korean**, only what fits the prompt.
- "recommendedKeywords" (array of strings): as above, **Korean-first** phrases useful for search or prompt expansion.

Rules:
- If the prompt is not visual, still interpret metaphorically into visual terms where reasonable; if impossible, describe abstract visual mood in structure/style **in Korean** and keep keywords useful and Korean-first.
- Be faithful to the user's wording; do not invent unrelated scenes.
- All five keys must be present. "recommendedKeywords" must be a JSON array of strings only.
- Strings should be plain text without trailing notes like "(JSON)".
`;

function resolveSystemInstruction(): string {
  if (process.env.GEMINI_MINIMAL_SYSTEM === '1') {
    return MINIMAL_SYSTEM_INSTRUCTION;
  }
  return ANALYSIS_SYSTEM_INSTRUCTION;
}

/** Google AI Studio 키는 보통 `AIza` 로 시작 */
function validateGeminiApiKeyShape(apiKey: string): { ok: true } | { ok: false; message: string } {
  const k = apiKey.trim();
  if (k.length < 30) {
    console.error('[analyzePrompt] API key rejected: too short');
    return {
      ok: false,
      message:
        'GOOGLE_GENERATIVE_AI_API_KEY 형식이 올바르지 않습니다. Google AI Studio에서 발급한 키(AIza…)인지 확인해 주세요.',
    };
  }
  if (!/^AIza[\w-]{20,}$/.test(k)) {
    console.error('[analyzePrompt] API key rejected: expected prefix AIza and alphanumeric body');
    return {
      ok: false,
      message:
        'GOOGLE_GENERATIVE_AI_API_KEY 형식이 올바르지 않을 수 있습니다. Google AI Studio에서 발급한 키를 사용하는지 확인해 주세요.',
    };
  }
  return { ok: true };
}

export type AnalyzePromptErrorCode =
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'EMPTY_PROMPT'
  | 'API_ERROR'
  | 'INVALID_JSON'
  | 'VALIDATION';

export type AnalyzePromptResult =
  | { ok: true; data: PromptAnalysis }
  | { ok: false; error: string; code: AnalyzePromptErrorCode };

function extractJsonObjectSubstring(raw: string): string | null {
  let s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    s = fenced[1].trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  return s.slice(start, end + 1);
}

function tryParseJsonFromModelText(raw: string): { ok: true; value: unknown } | { ok: false } {
  const candidates: string[] = [];
  const extracted = extractJsonObjectSubstring(raw);
  if (extracted) {
    candidates.push(extracted);
  }
  const trimmed = raw.trim();
  if (trimmed && !candidates.includes(trimmed)) {
    candidates.push(trimmed);
  }
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c) as unknown };
    } catch {
      /* try next candidate */
    }
  }
  return { ok: false };
}

type ClassifiedFailure = {
  userMessage: string;
  category: 'RATE_LIMIT' | 'NOT_FOUND' | 'AUTH' | 'SERVER' | 'RESPONSE' | 'UNKNOWN';
  evidence: Record<string, unknown>;
};

function errorMessageString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function rateLimitEvidence(err: unknown, msgLower: string): Record<string, unknown> | null {
  if (err instanceof GoogleGenerativeAIFetchError) {
    if (err.status === 429) {
      return { rule: 'http_429', httpStatus: 429 };
    }
    const reasons = err.errorDetails?.map((d) => String(d.reason ?? '').toUpperCase()) ?? [];
    const limitCodes = ['RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED'];
    const hit = reasons.find((r) => limitCodes.some((code) => r.includes(code)));
    if (hit) {
      return { rule: 'error_details_reason', reasons, matchedReason: hit };
    }
  }

  const resourcePhrases = [
    'resource_exhausted',
    'resource exhausted',
    'resource has been exhausted',
  ];
  const hitResource = resourcePhrases.find((p) => msgLower.includes(p));
  if (hitResource) {
    return { rule: 'message_resource_exhausted', phrase: hitResource };
  }

  if (
    msgLower.includes('rate limit') ||
    msgLower.includes('rate_limit') ||
    msgLower.includes('too many requests')
  ) {
    return { rule: 'message_rate_limit' };
  }
  if (msgLower.includes('quota exceeded') || msgLower.includes('exceeded your quota')) {
    return { rule: 'message_quota_exceeded' };
  }
  return null;
}

function classifyGeminiFailure(err: unknown): ClassifiedFailure {
  const msg = errorMessageString(err);
  const lower = msg.toLowerCase();

  if (err instanceof GoogleGenerativeAIFetchError) {
    const base: Record<string, unknown> = {
      httpStatus: err.status ?? null,
      statusText: err.statusText ?? null,
      messagePreview: msg.slice(0, 500),
      errorDetails: err.errorDetails ?? null,
    };

    if (err.status === 401 || err.status === 403) {
      return {
        category: 'AUTH',
        userMessage:
          'API 키가 올바르지 않거나 권한이 없습니다. 환경 변수 GOOGLE_GENERATIVE_AI_API_KEY를 확인해 주세요.',
        evidence: { ...base, rule: 'http_401_403' },
      };
    }
    if (err.status === 503 || err.status === 502 || err.status === 504) {
      return {
        category: 'SERVER',
        userMessage: 'Gemini 서비스가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        evidence: { ...base, rule: 'http_5xx' },
      };
    }
    const rl = rateLimitEvidence(err, lower);
    if (rl) {
      return {
        category: 'RATE_LIMIT',
        userMessage: '현재 요청이 많아 잠시 후 다시 시도해 주세요.',
        evidence: { ...base, ...rl },
      };
    }
    if (err.status === 404) {
      return {
        category: 'NOT_FOUND',
        userMessage: '모델 설정 오류입니다. 잠시 후 다시 시도해 주세요.',
        evidence: { ...base, rule: 'http_404' },
      };
    }

    return {
      category: 'UNKNOWN',
      userMessage: '프롬프트 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      evidence: base,
    };
  }

  if (lower.includes('api key') || lower.includes('invalid api key') || lower.includes('api_key_invalid')) {
    return {
      category: 'AUTH',
      userMessage:
        'API 키가 올바르지 않거나 권한이 없습니다. 환경 변수 GOOGLE_GENERATIVE_AI_API_KEY를 확인해 주세요.',
      evidence: { rule: 'message_api_key', messagePreview: msg.slice(0, 500) },
    };
  }
  if (lower.includes('permission denied') && (lower.includes('generativelanguage') || lower.includes('googleapis'))) {
    return {
      category: 'AUTH',
      userMessage:
        'API 키가 올바르지 않거나 권한이 없습니다. 환경 변수 GOOGLE_GENERATIVE_AI_API_KEY를 확인해 주세요.',
      evidence: { rule: 'message_permission_denied', messagePreview: msg.slice(0, 500) },
    };
  }

  const rl = rateLimitEvidence(err, lower);
  if (rl) {
    return {
      category: 'RATE_LIMIT',
      userMessage: '현재 요청이 많아 잠시 후 다시 시도해 주세요.',
      evidence: { ...rl, messagePreview: msg.slice(0, 500) },
    };
  }

  if (lower.includes('503') || lower.includes('502') || lower.includes('504')) {
    return {
      category: 'SERVER',
      userMessage: 'Gemini 서비스가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      evidence: { rule: 'message_5xx_hint', messagePreview: msg.slice(0, 500) },
    };
  }
  if (lower.includes('overloaded') || lower.includes('unavailable')) {
    return {
      category: 'SERVER',
      userMessage: 'Gemini 서비스가 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      evidence: { rule: 'message_overloaded', messagePreview: msg.slice(0, 500) },
    };
  }
  if (err instanceof GoogleGenerativeAIResponseError) {
    return {
      category: 'RESPONSE',
      userMessage: '모델이 안전 정책 등으로 응답을 생성하지 못했습니다. 프롬프트를 조정한 뒤 다시 시도해 주세요.',
      evidence: { rule: 'response_error', messagePreview: msg.slice(0, 500) },
    };
  }

  return {
    category: 'UNKNOWN',
    userMessage: '프롬프트 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    evidence: { rule: 'fallback', messagePreview: msg.slice(0, 500) },
  };
}

/**
 * Gemini만 호출(캐시 없음). 모델은 문자열 리터럴 `"gemini-2.5-flash"` 고정 (대시보드 텍스트 출력·Gemini 2.5 Flash).
 */
export async function analyzePrompt(userPrompt: string): Promise<AnalyzePromptResult> {
  const trimmed = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const resolved = readGeminiApiKeyFromEnv();
  if (!resolved.ok) {
    console.error(
      '[analyzePrompt] Missing API Key (server). Checked env names:',
      GEMINI_API_KEY_ENV_NAMES.join(', '),
      '| NODE_ENV:',
      process.env.NODE_ENV,
    );
    return {
      ok: false,
      error:
        'Google Generative AI API 키가 설정되지 않았습니다. 호스팅(Vercel 등) 환경 변수에 GOOGLE_GENERATIVE_AI_API_KEY(또는 GEMINI_API_KEY)를 Production·Preview에 등록한 뒤 재배포해 주세요.',
      code: 'MISSING_API_KEY',
    };
  }

  const apiKey = resolved.key;

  const keyCheck = validateGeminiApiKeyShape(apiKey);
  if (!keyCheck.ok) {
    return { ok: false, error: keyCheck.message, code: 'INVALID_API_KEY' };
  }

  if (process.env.NODE_ENV === 'development') {
    console.info(
      `[analyzePrompt] API key OK (length=${apiKey.length}, from=${resolved.source}), model="gemini-2.5-flash", minimalSystem=${process.env.GEMINI_MINIMAL_SYSTEM === '1'}`,
    );
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: resolveSystemInstruction(),
      generationConfig: {
        temperature: 0.35,
        responseMimeType: 'application/json',
      },
    });

    const result = await model.generateContent(trimmed);

    let text: string;
    try {
      text = result.response.text().trim();
    } catch (textErr) {
      console.error('Gemini API Error Details:', textErr);
      if (textErr instanceof GoogleGenerativeAIResponseError) {
        throw textErr;
      }
      throw textErr instanceof Error ? textErr : new Error(String(textErr));
    }

    if (!text) {
      return {
        ok: false,
        error: '모델이 빈 응답을 반환했습니다. 프롬프트를 바꿔 다시 시도해 주세요.',
        code: 'API_ERROR',
      };
    }

    const parsed = tryParseJsonFromModelText(text);
    if (!parsed.ok) {
      console.error(
        '[analyzePrompt] JSON parse failed after extraction. Raw preview:',
        text.slice(0, 400) + (text.length > 400 ? '…' : ''),
      );
      return {
        ok: false,
        error: '모델 응답을 JSON으로 해석할 수 없습니다. 다시 시도해 주세요.',
        code: 'INVALID_JSON',
      };
    }

    if (!isPlainRecord(parsed.value)) {
      return {
        ok: false,
        error: '분석 결과 형식이 올바르지 않습니다.',
        code: 'VALIDATION',
      };
    }

    const data = normalizePromptAnalysis(parsed.value);
    if (!data) {
      return {
        ok: false,
        error: '분석 결과에 필요한 필드가 누락되었거나 형식이 맞지 않습니다.',
        code: 'VALIDATION',
      };
    }

    return { ok: true, data };
  } catch (e) {
    console.error('Gemini API Error Details:', e);
    const classified = classifyGeminiFailure(e);
    console.error('[analyzePrompt] classified:', classified.category, classified.evidence);
    return {
      ok: false,
      error: classified.userMessage,
      code: 'API_ERROR',
    };
  }
}

/**
 * 레시피 상세용: DB에 동일 프롬프트 지문의 캐시가 있으면 API를 호출하지 않음.
 */
export async function analyzePostPromptAnalysis(
  postId: string,
  promptText: string,
  opts?: { forceRefresh?: boolean },
): Promise<AnalyzePromptResult> {
  const trimmed = typeof promptText === 'string' ? promptText.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      error: '분석할 프롬프트를 입력해 주세요.',
      code: 'EMPTY_PROMPT',
    };
  }

  const hash = fingerprintPrompt(trimmed);

  if (!opts?.forceRefresh) {
    const row = await prisma.aiMetadata.findUnique({
      where: { postId },
      select: { promptAnalysis: true, promptAnalysisPromptHash: true },
    });
    if (row?.promptAnalysisPromptHash === hash && row.promptAnalysis != null) {
      const cached = parseStoredPromptAnalysisJson(row.promptAnalysis);
      if (cached) {
        if (process.env.NODE_ENV === 'development') {
          console.info(`[analyzePostPromptAnalysis] cache hit postId=${postId}`);
        }
        return { ok: true, data: cached };
      }
    }
  }

  const res = await analyzePrompt(trimmed);
  if (!res.ok) {
    return res;
  }

  await prisma.aiMetadata.upsert({
    where: { postId },
    create: {
      postId,
      promptAnalysis: res.data as object,
      promptAnalysisPromptHash: hash,
    },
    update: {
      promptAnalysis: res.data as object,
      promptAnalysisPromptHash: hash,
    },
  });

  return res;
}
