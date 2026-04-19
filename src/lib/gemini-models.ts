/**
 * Google AI Studio / Generative Language API — 모델 ID 문자열.
 * @see https://ai.google.dev/gemini-api/docs/models
 * @see https://ai.google.dev/gemini-api/docs/api-versions
 *
 * [HTTP 404 참고]
 * - `@google/generative-ai` 기본 URL은 **v1beta**. 동일 모델이 **v1**에만 노출되거나 반대인 경우가 있어 `GEMINI_API_VERSION_CHAIN` 순으로 시도한다.
 * - **`gemini-2.0-flash`**: Google 측에서 신규 사용자·키에 대해 비활성화됨(AI Studio 로그에 “no longer available to new users”). 체인에 넣지 않는다.
 * - 키·프로젝트에 따라 모델 접미사(`-latest` 등)가 필요할 수 있음.
 * - 이미지 역분석·텍스트 분석 모두 **`responseMimeType: application/json` 생략** 후 텍스트에서 JSON 파싱(간헐 404 완화).
 */
/** SDK 기본과 안정판 순서 — 404 시 다음 버전으로 폴백 */
export const GEMINI_API_VERSION_CHAIN = ['v1beta', 'v1'] as const;
export const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash' as const; // 대시보드 명칭
/** 2.0 Flash 계열은 신규 키에서 404 — 2.5 Flash-Lite(가용·비용 효율)로 폴백 */
export const GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash-lite' as const;
export const GEMINI_MODEL_TERTIARY = 'gemini-1.5-flash-latest' as const; // 1.5는 -latest가 가장 확실함

/**
 * 이미지 역분석: 순차 시도 (`gemini-2.0-flash` 미포함 — 신규 계정 비가용)
 */
export const GEMINI_IMAGE_MODEL_CHAIN = [
  GEMINI_MODEL_PRIMARY,
  'gemini-2.5-flash-latest',
  GEMINI_MODEL_FALLBACK,
  'gemini-1.5-flash',
  GEMINI_MODEL_TERTIARY,
] as const;

/**
 * GeekNews 텍스트 요약: `GEMINI_API_VERSION_CHAIN`(v1beta→v1)와 함께 순차 시도.
 * 키·프로젝트마다 특정 `*-latest` 또는 API 버전 조합이 없을 수 있어 이미지 체인과 동일한 순서.
 */
export const GEMINI_GEEKNEWS_MODEL_CHAIN = [
  GEMINI_MODEL_PRIMARY,
  'gemini-2.5-flash-latest',
  GEMINI_MODEL_FALLBACK,
  'gemini-1.5-flash',
  GEMINI_MODEL_TERTIARY,
] as const;
