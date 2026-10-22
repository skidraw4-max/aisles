import styles from '@/app/(root)/page.module.css';

/** `/?category=AI_FORTUNE` — 피드 상단 SEO·애드센스용 소개 (SSR, 숨김 없음) */
export function AiFortuneCategoryIntro() {
  return (
    <section className={styles.aiFortuneCategoryIntro} aria-labelledby="ai-fortune-intro-heading">
      <h2 id="ai-fortune-intro-heading" className={styles.aiFortuneCategoryIntroTitle}>
        AI FORTUNE 주간 리포트
      </h2>
      <p>
        AI FORTUNE은 AIsle이 매주 발행하는 <strong>AI 트렌드·커리어 주간 리포트</strong>입니다. 지난
        한 주 동안 LOUNGE(AI 트렌드)와 LAB·BUILD 등에 모인 글로벌 AI 뉴스·도구·연구 흐름을 바탕으로,
        이번 주에 주목할 기술·서비스·업무 방식의 변화를 한 편의 글로 정리합니다. Hacker News,
        GeekNews, MIT News, Techmeme 등에서 수집·요약된 소식과 사이트 내 인기 글을 함께 반영해,
        “이번 주 AI 업계에서 무엇이 달라졌는지”를 빠르게 파악할 수 있도록 구성했습니다.
      </p>
      <p>
        리포트 본문에는 주간 <strong>AI 흐름 요약</strong>과 함께, MBTI 16유형별{' '}
        <strong>AI 활용 전략·행운의 키워드·피할 습관</strong>이 포함됩니다. INTJ·ENFP 등 유형마다
        다른 업무 스타일과 학습 습관을 전제로, 이번 주 트렌드에 맞춘 실무 팁과 마음가짐을 제안합니다.
        별도 유형 선택 없이 한 글에서 16유형 전체를 읽을 수 있어, 팀·스터디에서 공유하기에도
        적합합니다.
      </p>
      <p>
        아래 목록은 <strong>주차(aiFortuneWeekKey) 최신순</strong>으로 정렬됩니다. 가장 위가 이번
        주(또는 가장 최근 발행분)이며, 이전 주차 리포트는 「지난 주차」에서 이어집니다. 매주 월요일
        05:00(KST) 전후에 새 리포트가 추가되며, 과거 주차는 아카이브로 남아 언제든 다시 볼 수
        있습니다.
      </p>
    </section>
  );
}
