/** 갤러리 이미지 역분석 JSON에서 추정 프롬프트 문자열 추출 */
export function pickEstimatedPromptFromAnalysis(data: Record<string, unknown>): string {
  const keys = ['estimatedPrompt', '추정프롬프트', 'estimated_prompt', 'prompt', '프롬프트'];
  for (const k of keys) {
    const v = data[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}
