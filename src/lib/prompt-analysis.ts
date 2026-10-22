/** Gemini 프롬프트 분석 결과(JSON) — 이미지 생성용 vs 마케팅/카피용 */

export type VisualPromptAnalysis = {
  mode: 'visual';
  structure: string;
  style: string;
  lighting: string;
  composition: string;
  recommendedKeywords: string[];
};

export type MarketingPromptAnalysis = {
  mode: 'marketing';
  /** 타겟 분석 */
  targetAnalysis: string;
  /** 설득력 점수(및 근거 한 줄 등) */
  persuasionScore: string;
  /** 대안 문구 정확히 3개 */
  alternativePhrases: [string, string, string];
};

export type PromptAnalysis = VisualPromptAnalysis | MarketingPromptAnalysis;

export function isMarketingAnalysis(p: PromptAnalysis): p is MarketingPromptAnalysis {
  return p.mode === 'marketing';
}

export function isVisualAnalysis(p: PromptAnalysis): p is VisualPromptAnalysis {
  return p.mode === 'visual';
}

export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function normalizeVisual(raw: Record<string, unknown>): VisualPromptAnalysis | null {
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
    mode: 'visual',
    structure: structure.trim(),
    style: style.trim(),
    lighting: lighting.trim(),
    composition: composition.trim(),
    recommendedKeywords,
  };
}

function normalizeMarketing(raw: Record<string, unknown>): MarketingPromptAnalysis | null {
  const targetAnalysis = raw.targetAnalysis;
  const persuasionScore = raw.persuasionScore;
  const alt = raw.alternativePhrases;

  if (typeof targetAnalysis !== 'string' || typeof persuasionScore !== 'string') {
    return null;
  }
  if (!Array.isArray(alt) || alt.length !== 3) {
    return null;
  }
  const a0 = alt[0];
  const a1 = alt[1];
  const a2 = alt[2];
  if (typeof a0 !== 'string' || typeof a1 !== 'string' || typeof a2 !== 'string') {
    return null;
  }
  const t0 = a0.trim();
  const t1 = a1.trim();
  const t2 = a2.trim();
  if (!t0 || !t1 || !t2) {
    return null;
  }

  return {
    mode: 'marketing',
    targetAnalysis: targetAnalysis.trim(),
    persuasionScore: persuasionScore.trim(),
    alternativePhrases: [t0, t1, t2],
  };
}

/**
 * 레거시 캐시: `mode` 없이 structure 등만 있는 경우 → visual 로 간주
 */
export function normalizePromptAnalysis(raw: Record<string, unknown>): PromptAnalysis | null {
  const mode = raw.mode;

  if (mode === 'marketing') {
    return normalizeMarketing(raw);
  }

  if (mode === 'visual') {
    return normalizeVisual(raw);
  }

  if (typeof raw.targetAnalysis === 'string' && Array.isArray(raw.alternativePhrases)) {
    const m = normalizeMarketing(raw);
    if (m) return m;
  }

  return normalizeVisual(raw);
}

/** DB `Json` 필드 등에서 복원 (`'use server'` 모듈 밖에서 사용) */
export function parseStoredPromptAnalysisJson(value: unknown): PromptAnalysis | null {
  if (!isPlainRecord(value)) return null;
  return normalizePromptAnalysis(value);
}
