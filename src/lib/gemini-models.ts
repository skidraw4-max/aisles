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
/** full 2.5 Flash — 품질·용량 폴백(2.5 Flash TPM 버킷 소비) */
export const GEMINI_MODEL_PRIMARY = 'gemini-2.5-flash' as const;
/** 2.5 Flash-Lite — interactive·배치 1순위(별도 TPM/RPM 버킷, 비용·지연 절감) */
export const GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash-lite' as const;
export const GEMINI_MODEL_TERTIARY = 'gemini-1.5-flash-latest' as const; // 1.5는 -latest가 가장 확실함

/**
 * LAB 프롬프트 분석·의도 분류: Flash-Lite 우선으로 2.5 Flash TPM 버킷 압력 완화.
 * Lite 실패(404·모델 미노출) 시 full 2.5 Flash → 1.5-flash-latest 순. `gemini-2.0-flash` 미포함.
 */
export const GEMINI_LAB_MODEL_CHAIN = [
  GEMINI_MODEL_FALLBACK,
  GEMINI_MODEL_PRIMARY,
  GEMINI_MODEL_TERTIARY,
] as const;

/**
 * 이미지 역분석: Flash-Lite 우선(TPM). full 2.5·`-latest`·1.5 변형 후 최후 1.5-flash-latest.
 * `gemini-2.0-flash` 미포함 — 신규 계정 비가용.
 */
export const GEMINI_IMAGE_MODEL_CHAIN = [
  GEMINI_MODEL_FALLBACK,
  GEMINI_MODEL_PRIMARY,
  'gemini-2.5-flash-latest',
  'gemini-1.5-flash',
  GEMINI_MODEL_TERTIARY,
] as const;

/**
 * LOUNGE 뉴스 동기화 텍스트 요약: `GEMINI_API_VERSION_CHAIN`(v1beta→v1)와 함께 순차 시도.
 * 크론·배치는 Flash-Lite만 사용해 RPM/RPD 할당량·429 압력을 줄인다.
 * 2.5 Flash 폴백은 제외 — Lite 실패 시 1.5-flash-latest만 최후 수단.
 */
export const GEMINI_GEEKNEWS_MODEL_CHAIN = [
  GEMINI_MODEL_FALLBACK,
  GEMINI_MODEL_TERTIARY,
] as const;
