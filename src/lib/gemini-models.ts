/**
 * Google AI Studio / Generative Language API — 모델 ID 문자열.
 * @see https://ai.google.dev/gemini-api/docs/models
 * @see https://ai.google.dev/gemini-api/docs/api-versions
 *
 * [HTTP 404 참고]
 * - `@google/generative-ai` 기본 URL은 **v1beta**. 동일 모델이 **v1**에만 노출되거나 반대인 경우가 있어 `GEMINI_API_VERSION_CHAIN` 순으로 시도한다.
 * - 키·프로젝트에 따라 모델 접미사(`-latest`, `-exp`)가 필요할 수 있음.
 * - 이미지 역분석·텍스트 분석 모두 **`responseMimeType: application/json` 생략** 후 텍스트에서 JSON 파싱(간헐 404 완화).
 */
/** SDK 기본과 안정판 순서 — 404 시 다음 버전으로 폴백 */
export const GEMINI_API_VERSION_CHAIN = ['v1beta', 'v1'] as const;
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
