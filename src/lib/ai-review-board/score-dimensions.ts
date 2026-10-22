/** SEO / GEO 는 반드시 분리 (1차 승인) */
export const SCORE_DIMENSIONS = [
  'ui_ux',
  'visual',
  'mobile',
  'web_tech',
  'performance',
  'a11y',
  'usability',
  'content',
  'community',
  'ai_usage',
  'competitive',
  'acquisition',
  'retention',
  'seo',
  'geo',
  'security',
  'scalability',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  ui_ux: 'UI/UX',
  visual: '비주얼 디자인',
  mobile: '모바일/반응형',
  web_tech: '웹 기술',
  performance: '성능/속도',
  a11y: '접근성',
  usability: '사용자 편의성',
  content: '콘텐츠 구조',
  community: '커뮤니티 기능',
  ai_usage: 'AI 활용',
  competitive: '경쟁 서비스 대비 기능',
  acquisition: '사용자 유입 가능성',
  retention: '재방문 가능성',
  seo: 'SEO',
  geo: 'GEO',
  security: '보안 및 신뢰성',
  scalability: '확장성',
};

export function isScoreDimension(value: string): value is ScoreDimension {
  return (SCORE_DIMENSIONS as readonly string[]).includes(value);
}
