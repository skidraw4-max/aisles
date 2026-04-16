/**
 * Google AI Studio / Generative Language API — 모델 ID 문자열.
 * @see https://ai.google.dev/gemini-api/docs/models
 *
 * - primary: 이미지·텍스트 멀티모달 분석 공통
 * - fallback: 일부 환경에서 2.5 미노출·404 시 차선 (대시보드 명칭 gemini-2-flash)
 */
export const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash' as const;
export const GEMINI_MODEL_FALLBACK = 'gemini-2-flash' as const;

/** 이미지 역분석: 순차 시도 (404·NOT_FOUND 시 다음으로) */
export const GEMINI_IMAGE_MODEL_CHAIN = [GEMINI_MODEL_PRIMARY, GEMINI_MODEL_FALLBACK] as const;
