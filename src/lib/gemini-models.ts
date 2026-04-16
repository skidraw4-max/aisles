/**
 * Google AI Studio / Generative Language API — 모델 ID 문자열.
 * @see https://ai.google.dev/gemini-api/docs/models
 *
 * [추후 동일 오류(HTTP 404) 참고]
 * - 404는 할당량(보통 429)과 다름. 키·프로젝트·지역에 따라 **모델 접미사**(`-latest`, `-exp`)가 필요할 수 있음.
 * - 이미지 역분석은 `GEMINI_IMAGE_MODEL_CHAIN`을 넓게 두고, `analyzeImage`에서 멀티모달 시 **`responseMimeType: application/json` 미사용** 권장(간헐 404 완화).
 */
export const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash' as const; // 대시보드 명칭
export const GEMINI_MODEL_FALLBACK = 'gemini-2.0-flash-exp' as const; // 2.0은 현재 -exp(실험용) 접미사가 필요할 수 있음
export const GEMINI_MODEL_TERTIARY = 'gemini-1.5-flash-latest' as const; // 1.5는 -latest가 가장 확실함

/**
 * 이미지 역분석: 순차 시도 (중복·별칭 포함 — 키별로 노출되는 ID가 다름)
 */
export const GEMINI_IMAGE_MODEL_CHAIN = [
  GEMINI_MODEL_PRIMARY,
  'gemini-2.5-flash-latest',
  'gemini-2.0-flash',
  GEMINI_MODEL_FALLBACK,
  'gemini-1.5-flash',
  GEMINI_MODEL_TERTIARY,
] as const;
