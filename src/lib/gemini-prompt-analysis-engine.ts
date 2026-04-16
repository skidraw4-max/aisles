/**
 * Gemini 프롬프트 분석 — 동기·스트리밍 공통 (서버 액션/API 라우트에서 사용).
 * `app/actions/gemini.ts`는 인증·DB와 이 모듈을 연결합니다.
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIResponseError,
} from '@google/generative-ai';
import {
  isPlainRecord,
  normalizePromptAnalysis,
  type PromptAnalysis,
} from '@/lib/prompt-analysis';

export type { PromptAnalysis };

export const GEMINI_API_KEY_ENV_NAMES = [
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'GOOGLE_AI_API_KEY',
] as const;

export function logGeminiKeyEnvDiagnostics(): void {
  console.error('[analyzePrompt] Gemini API key — per-variable state (value not logged):');
  for (const name of GEMINI_API_KEY_ENV_NAMES) {
    const v = process.env[name];
    if (v === undefined) {
      console.error(`  ${name}: undefined`);
    } else if (v === null) {
      console.error(`  ${name}: null`);
    } else if (typeof v !== 'string') {
      console.error(`  ${name}: unexpected type ${typeof v}`);
    } else if (!v.trim()) {
      console.error(`  ${name}: empty or whitespace only`);
    } else {
      console.error(`  ${name}: present (trimmed length=${v.trim().length})`);
    }
  }
  console.error(
    '[analyzePrompt] Context: NODE_ENV=',
    process.env.NODE_ENV,
    'VERCEL_ENV=',
    process.env.VERCEL_ENV ?? '(unset)',
    'VERCEL=',
    process.env.VERCEL ?? '(unset)',
  );
}

export function readGeminiApiKeyFromEnv():
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

const VISUAL_ANALYSIS_SYSTEM_INSTRUCTION = `You are a senior creative director and prompt engineer specialized in visual media (illustration, photography, 3D, film frames, concept art).

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
- "mode" (string): MUST always be exactly "visual".
- "structure" (string): subject hierarchy, focal points, foreground/midground/background, props, negative space, level of detail — concise, **in Korean**, specific to the user's prompt.
- "style" (string): art direction, era, medium, texture, color palette tendencies, references — **in Korean**, grounded in what the prompt implies.
- "lighting" (string): light quality, direction, time of day, contrast, shadows, atmosphere — **in Korean**, only what fits the prompt.
- "composition" (string): framing, camera angle, lens feel, rule of thirds, symmetry, leading lines — **in Korean**, only what fits the prompt.
- "recommendedKeywords" (array of strings): as above, **Korean-first** phrases useful for search or prompt expansion.

Rules:
- If the prompt is not visual, still interpret metaphorically into visual terms where reasonable; if impossible, describe abstract visual mood in structure/style **in Korean** and keep keywords useful and Korean-first.
- Be faithful to the user's wording; do not invent unrelated scenes.
- All keys above must be present. "recommendedKeywords" must be a JSON array of strings only.
- Strings should be plain text without trailing notes like "(JSON)".
`;

const MARKETING_ANALYSIS_SYSTEM_INSTRUCTION = `You are a senior marketing strategist and copy chief (Korean market).

CRITICAL — OUTPUT FORMAT (must follow exactly):
- Respond with PURE JSON ONLY: a single JSON object, RFC 8259 compliant.
- Do NOT wrap in markdown code fences. No prose outside the JSON.

CRITICAL — LANGUAGE:
- All string values must be **natural Korean**.

Output EXACTLY one JSON object with these keys only:
- "mode" (string): MUST always be exactly "marketing".
- "targetAnalysis" (string): 타겟 독자·상황·니즈, 브랜드 톤/어조, 채널에 맞는 메시지 방향 — **한국어**로 구체적으로.
- "persuasionScore" (string): 설득력을 0–10 점 형태로 제시하고, 한 줄 근거(왜 그 점수인지) — **한국어**.
- "alternativePhrases" (array of strings): **정확히 3개**의 대안 문구(헤드라인·본문 훅·CTA 등 프롬프트 성격에 맞게). 각 항목은 한국어 문자열. 중복 금지, 빈 문자열 금지.

Rules:
- Be faithful to the user's brief; suggest realistic alternatives.
`;

const CLASSIFY_PROMPT_INTENT_SYSTEM = `You classify a single user message (a "prompt" for LAB).

Decide the primary intent:
- "image" — Visual / generative media: scenes, illustration, photo, video look, camera, lighting, composition, characters, art style, UI shown as image, Midjourney/Stable Diffusion/DALL·E style instructions, etc.
- "marketing" — Copywriting & messaging: ad headlines, SNS posts, product descriptions, brand slogans, email/marketing copy, landing text, persuasion without describing a picture to generate.

Respond with PURE JSON only, one line: {"intent":"image"} OR {"intent":"marketing"}`;

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

export function tryParseJsonFromModelText(raw: string): { ok: true; value: unknown } | { ok: false } {
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

async function classifyPromptIntent(
  genAI: GoogleGenerativeAI,
  userPrompt: string,
): Promise<'image' | 'marketing'> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: CLASSIFY_PROMPT_INTENT_SYSTEM,
      generationConfig: {
        temperature: 0.15,
        responseMimeType: 'application/json',
      },
    });
    const result = await model.generateContent(userPrompt);
    const text = result.response.text().trim();
    const parsed = tryParseJsonFromModelText(text);
    if (!parsed.ok || !isPlainRecord(parsed.value)) {
      return 'image';
    }
    const intent = parsed.value.intent;
    if (intent === 'marketing') {
      return 'marketing';
    }
    return 'image';
  } catch (e) {
    console.warn('[analyzePrompt] classifyPromptIntent failed, defaulting to image:', e);
    return 'image';
  }
}

export function validateGeminiApiKeyShape(apiKey: string): { ok: true } | { ok: false; message: string } {
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
  | 'UNAUTHENTICATED'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'EMPTY_PROMPT'
  | 'API_ERROR'
  | 'INVALID_JSON'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'TIMEOUT';

export type AnalyzePromptResult =
  | { ok: true; data: PromptAnalysis; notice?: string }
  | { ok: false; error: string; code: AnalyzePromptErrorCode };

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
        userMessage: '현재 API 사용량이 많습니다. 1분 뒤에 다시 시도해주세요.',
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
      userMessage: '현재 API 사용량이 많습니다. 1분 뒤에 다시 시도해주세요.',
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

function parseModelJsonTextToResult(text: string): AnalyzePromptResult {
  if (!text.trim()) {
    return {
      ok: false,
      error: '모델이 빈 응답을 반환했습니다. 프롬프트를 바꿔 다시 시도해 주세요.',
      code: 'API_ERROR',
    };
  }

  const parsed = tryParseJsonFromModelText(text);
  if (!parsed.ok) {
    console.error(
      '[gemini-engine] JSON parse failed after extraction. Raw preview:',
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
    console.log('[gemini-engine] response validation failed (normalizePromptAnalysis)');
    return {
      ok: false,
      error: '분석 결과에 필요한 필드가 누락되었거나 형식이 맞지 않습니다.',
      code: 'VALIDATION',
    };
  }

  console.log('[gemini-engine] response ok', {
    mode: 'mode' in data ? data.mode : undefined,
    keys: Object.keys(data as object),
  });
  return { ok: true, data };
}

export function geminiFailureToResult(e: unknown): AnalyzePromptResult {
  console.error('[gemini-engine] Gemini API Error Details:', e);
  const classified = classifyGeminiFailure(e);
  console.error('[gemini-engine] classified:', classified.category, classified.evidence);
  const code: AnalyzePromptErrorCode =
    classified.category === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'API_ERROR';
  return {
    ok: false,
    error: classified.userMessage,
    code,
  };
}

async function getAnalysisModel(genAI: GoogleGenerativeAI, trimmed: string) {
  let systemInstruction: string;
  if (process.env.GEMINI_MINIMAL_SYSTEM === '1') {
    systemInstruction = MINIMAL_SYSTEM_INSTRUCTION;
  } else {
    const intent = await classifyPromptIntent(genAI, trimmed);
    systemInstruction =
      intent === 'marketing'
        ? MARKETING_ANALYSIS_SYSTEM_INSTRUCTION
        : VISUAL_ANALYSIS_SYSTEM_INSTRUCTION;
  }

  return genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig: {
      temperature: 0.35,
      responseMimeType: 'application/json',
    },
  });
}

/** 동기 `generateContent` — 백그라운드 작업·기존 경로 */
export async function executeGeminiPromptAnalysisWithApiKey(
  trimmed: string,
  apiKey: string,
): Promise<AnalyzePromptResult> {
  console.log('[executeGeminiPromptAnalysis] request start', {
    promptLength: trimmed.length,
    promptPreview: `${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}`,
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = await getAnalysisModel(genAI, trimmed);
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

    return parseModelJsonTextToResult(text);
  } catch (e) {
    return geminiFailureToResult(e);
  }
}

/** `generateContentStream` — 델타마다 `onTextDelta` 호출 후 최종 파싱 */
export async function streamGeminiPromptAnalysisWithApiKey(
  trimmed: string,
  apiKey: string,
  onTextDelta: (delta: string) => void,
): Promise<AnalyzePromptResult> {
  console.log('[streamGeminiPromptAnalysis] request start', {
    promptLength: trimmed.length,
    promptPreview: `${trimmed.slice(0, 120)}${trimmed.length > 120 ? '…' : ''}`,
  });

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = await getAnalysisModel(genAI, trimmed);
    const streamResult = await model.generateContentStream(trimmed);

    let fullText = '';
    for await (const chunk of streamResult.stream) {
      let piece = '';
      try {
        piece = chunk.text();
      } catch (textErr) {
        console.error('Gemini stream chunk text() error:', textErr);
        if (textErr instanceof GoogleGenerativeAIResponseError) {
          throw textErr;
        }
        throw textErr instanceof Error ? textErr : new Error(String(textErr));
      }
      if (piece) {
        fullText += piece;
        onTextDelta(piece);
      }
    }

    return parseModelJsonTextToResult(fullText.trim());
  } catch (e) {
    return geminiFailureToResult(e);
  }
}

export function missingApiKeyResult(): AnalyzePromptResult {
  return {
    ok: false,
    error:
      '서버에 Gemini API 키가 없습니다. Google AI Studio(https://aistudio.google.com/apikey)에서 키를 만든 뒤, Vercel → Project → Settings → Environment Variables에 이름 GOOGLE_GENERATIVE_AI_API_KEY(또는 GEMINI_API_KEY)로 값을 넣고 Environment에 Production과 Preview를 모두 선택한 다음 저장하고 재배포해 주세요.',
    code: 'MISSING_API_KEY',
  };
}
