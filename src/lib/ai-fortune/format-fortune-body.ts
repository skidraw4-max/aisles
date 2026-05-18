import type { AiFortuneWeeklyPayload } from '@/lib/ai-fortune/payload';

/** 피드·SEO·레거시 뷰용 마크다운 요약 (상세 UI는 aiFortunePayload) */
export function formatAiFortunePostBody(data: AiFortuneWeeklyPayload): string {
  const trends = data.trendBullets
    .map((t, i) => `### ${i + 1}. 트렌드\n\n${t}`)
    .join('\n\n');

  const mbtiPreview = data.mbti
    .slice(0, 4)
    .map((m) => `**${m.type}** — ${m.luckyKeyword}`)
    .join('\n');

  return `## ${data.weekLabel} — AI FORTUNE

지난주 글로벌 AI 흐름과 16가지 MBTI 유형별 커리어·AI 활용 운세입니다. 상세 리포트에서 전체 카드를 확인하세요.

---

## 지난주 AI 트렌드

${trends}

---

## MBTI 미리보기

${mbtiPreview}

…외 ${data.mbti.length - 4}유형 — [전체 리포트 보기](#ai-fortune-grid)
`;
}
