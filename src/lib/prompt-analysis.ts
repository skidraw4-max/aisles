/** Gemini 프롬프트 분석 결과(JSON)와 동일 스키마 */
export type PromptAnalysis = {
  structure: string;
  style: string;
  lighting: string;
  composition: string;
  recommendedKeywords: string[];
};

export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizePromptAnalysis(raw: Record<string, unknown>): PromptAnalysis | null {
  const structure = raw.structure;
  const style = raw.style;
  const lighting = raw.lighting;
  const composition = raw.composition;
  const kw = raw.recommendedKeywords;

  if (
    typeof structure !== 'string' ||
    typeof style !== 'string' ||
    typeof lighting !== 'string' ||
    typeof composition !== 'string' ||
    !Array.isArray(kw)
  ) {
    return null;
  }

  const recommendedKeywords = kw.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );

  if (recommendedKeywords.length === 0) {
    return null;
  }

  return {
    structure: structure.trim(),
    style: style.trim(),
    lighting: lighting.trim(),
    composition: composition.trim(),
    recommendedKeywords,
  };
}

/** DB `Json` 필드 등에서 복원 (`'use server'` 모듈 밖에서 사용) */
export function parseStoredPromptAnalysisJson(value: unknown): PromptAnalysis | null {
  if (!isPlainRecord(value)) return null;
  return normalizePromptAnalysis(value);
}
