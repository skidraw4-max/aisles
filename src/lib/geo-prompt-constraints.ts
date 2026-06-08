/**
 * GEO(Generative Engine Optimization) — Gemini 뉴스·운세 프롬프트 공통 제약.
 * AI 검색·답변 엔진(Perplexity, ChatGPT Browse 등)이 인용하기 좋은 사실 중심 문장을 유도한다.
 */

/** 모든 뉴스·테크 요약 SYSTEM 블록 끝에 붙인다. */
export const GEO_FACTUAL_WRITING_CONSTRAINTS = `
GEO(생성형 검색 최적화) 작성 제약 — 반드시 준수:
- 추상적 수식·미사여구·"혁신적", "획기적", "게임 체인저" 등 근거 없는 과장 표현을 배제한다.
- 고유명사(회사·인물·제품·프로젝트·논문·모델명), 출시·공개된 기술 이름, 정확한 수치·통계·버전 번호, 발표·출시·연구 공개일(YYYY-MM-DD 또는 연·월)을 본문에 반드시 포함한다. 원문에 있으면 생략 금지.
- 객관적 사실 서술 톤을 유지한다(주관적 추측·감탄·수사적 질문 최소화). AI 검색·답변 엔진이 인용하기 좋은 문장으로 쓴다.
`;

/** introduction·easySummary 등 짧은 상단 요약 필드용 — 뉴스 계열 크론. */
export const GEO_NEWS_INTRO_THREE_LINE_CONSTRAINT = `
짧은 상단 요약(introduction, easySummary 등 해당 필드)은 **정확히 3줄**(각 줄 1문장, 줄 구분은 \\n)로 작성한다. 3줄 각각에 고유명사·수치·날짜 중 하나 이상을 포함한다.
`;

/** AI FORTUNE trendBullets·MBTI strategy 등 사실 앵커 강화. */
export const GEO_FORTUNE_FACT_CONSTRAINTS = `
GEO 제약 — 트렌드·전략 문장에도 적용:
- trendBullets 각 항목에 구체적 제품명·회사명·모델명·수치·발표 시점 중 2가지 이상을 포함한다.
- 추상적 미래 예언("AI가 모든 것을 바꿀 것") 대신 지난주 헤드라인에 등장한 실명·사건을 근거로 쓴다.
- strategy 문장도 재치는 유지하되, 행운 키워드·피할 습관과 함께 실존 AI 도구·서비스명을 1개 이상 넣는다.
`;
