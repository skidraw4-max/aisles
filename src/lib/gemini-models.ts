/**
 * Google AI Studio / Generative Language API — 모델 ID 문자열.
 * @see https://ai.google.dev/gemini-api/docs/models
 *
 * - primary: 이미지·텍스트 멀티모달 분석 공통
 * - fallback: AI Studio UI의 "Gemini 2.0 Flash" 등에 대응하는 **공식 ID는 `gemini-2.0-flash`**.
 *   (`gemini-2-flash`처럼 점(.) 없는 문자열은 API에서 404가 나는 경우가 많음)
 * - tertiary: 2.5·2.0 모두 키/지역에서 막힐 때 마지막 시도
 */
export const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash' as const;
export const GEMINI_MODEL_FALLBACK = 'gemini-2.0-flash' as const;
export const GEMINI_MODEL_TERTIARY = 'gemini-1.5-flash' as const;

/** 이미지 역분석: 순차 시도 (404·NOT_FOUND 시 다음으로) */
export const GEMINI_IMAGE_MODEL_CHAIN = [
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL_FALLBACK,
  GEMINI_MODEL_TERTIARY,
] as const;
