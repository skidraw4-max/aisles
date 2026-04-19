/**
 * 제목에 AI·ML 관련 키워드가 있으면 우선순위(정렬 시 앞으로).
 * 대소문자 무시, 단어 경계·구문 매칭 혼합.
 */
const AI_TITLE_PATTERNS: RegExp[] = [
  /\bai\b/i,
  /\bagi\b/i,
  /\bmlops?\b/i,
  /machine learning/i,
  /\bgpt\b/i,
  /\bllm(s)?\b/i,
  /\brag\b/i,
  /deep learning/i,
  /neural( network)?/i,
  /artificial intelligence/i,
  /\bopenai\b/i,
  /\banthropic\b/i,
  /\bclaude\b/i,
  /\bgemini\b/i,
  /langchain/i,
  /\bpytorch\b/i,
  /\btensorflow\b/i,
  /hugging\s*face/i,
  /fine[- ]?tun/i,
  /generative/i,
  /\btransformer(s)?\b/i,
  /\bmistral\b/i,
  /\bllama\b/i,
  /stable diffusion/i,
  /diffusion model/i,
  /\bembedding(s)?\b/i,
  /\binference\b/i,
  /\bagent(s)?\b/i,
  /multimodal/i,
];

export function titleMatchesAiKeywords(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  return AI_TITLE_PATTERNS.some((re) => re.test(t));
}
