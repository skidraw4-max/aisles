import type { AiFortuneWeeklyJson } from '@/lib/ai-fortune/generate-weekly-fortune';

export function formatAiFortunePostBody(data: AiFortuneWeeklyJson, weekLabel: string): string {
  const trends = data.trendBullets
    .map((t, i) => `### ${i + 1}. 트렌드\n\n${t}`)
    .join('\n\n');

  return `## ${weekLabel} — AI FORTUNE

지난주 전 세계 AI 산업의 흐름을 바탕으로, 이번 주 커리어·학습에 참고할 운세 가이드를 담았습니다.

---

## 지난주 AI 트렌드 5선

${trends}

---

## 이번 주 운세 가이드

### ✨ 행운의 키워드

${data.luckyKeywords}

### 🚫 피해야 할 행동

${data.avoidActions}

### 📚 추천 학습 분야

${data.learningAreas}

### 🎭 MBTI별 한 줄 조언

${data.mbtiHighlights}

---

${data.closingNote}
`;
}
