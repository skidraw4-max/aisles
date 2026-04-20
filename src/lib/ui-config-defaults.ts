import type { Category } from '@prisma/client';

/** Prisma 카테고리 → UI 설정 키 (복도 표시명) */
export const CATEGORY_TO_UI_KEY: Record<Category, string> = {
  RECIPE: 'corridor.lab',
  GALLERY: 'corridor.gallery',
  LOUNGE: 'corridor.lounge',
  GOSSIP: 'corridor.gossip',
  BUILD: 'corridor.build',
  LAUNCH: 'corridor.launch',
  TREND: 'corridor.trend',
};

const POST_CATEGORY_ORDER: Category[] = [
  'RECIPE',
  'GALLERY',
  'LOUNGE',
  'GOSSIP',
  'BUILD',
  'LAUNCH',
];

/**
 * UI 카피 기본값 + 시드 설명.
 * 관리자(BO)에서 수정 시 DB가 우선이며, 누락 시 이 값이 사용됩니다.
 */
export type UiConfigSeedRow = {
  key: string;
  value: string;
  description: string;
};

export const UI_CONFIG_SEED: readonly UiConfigSeedRow[] = [
  // 복도·메뉴 (헤더·탭·뱃지 공통)
  { key: 'corridor.all', value: '전체', description: '메인 네비·콘텐츠 탭 — 전체' },
  { key: 'corridor.lab', value: 'AI 연구소', description: '복도 표시명 (LAB/RECIPE)' },
  { key: 'corridor.gallery', value: '쇼케이스', description: '복도 표시명 (GALLERY)' },
  { key: 'corridor.lounge', value: 'AI 트렌드', description: '복도 표시명 (LOUNGE)' },
  { key: 'corridor.gossip', value: '커뮤니티', description: '복도 표시명 (GOSSIP)' },
  { key: 'corridor.build', value: '제작기', description: '복도 표시명 (BUILD)' },
  { key: 'corridor.launch', value: '출시', description: '복도 표시명 (LAUNCH)' },
  {
    key: 'corridor.trend',
    value: '이전 분류 (TREND)',
    description: '구 TREND 게시글 뱃지용 — 메뉴 비노출',
  },
  { key: 'corridor.guide', value: '가이드', description: '상단 /about 링크' },
  { key: 'header.upload', value: '레시피 등록', description: '헤더 업로드 버튼 라벨' },

  // 홈 히어로 (page.tsx)
  {
    key: 'home.hero.eyebrow_home',
    value: '프롬프트 레시피 · 역설계 · 워크플로우',
    description: '홈 히어로 소제목(복도 미선택)',
  },
  {
    key: 'home.hero.eyebrow_filtered',
    value: 'Four aisles, one workspace',
    description: '홈 히어로 소제목(복도 선택)',
  },
  {
    key: 'home.hero.title_home_line1',
    value: 'AI 프롬프트를 분석하고 역설계하다',
    description: '홈 히어로 제목 1행',
  },
  {
    key: 'home.hero.title_home_line2_accent',
    value: 'AIsle',
    description: '홈 히어로 제목 강조',
  },
  {
    key: 'home.hero.title_home_line2_rest',
    value: ': 당신만의 레시피 저장소',
    description: '홈 히어로 제목 2행 나머지',
  },
  {
    key: 'home.hero.lead_home',
    value:
      '모든 AI 결과물 속 숨겨진 프롬프트를 AI Vision으로 추출하고, 최적화된 마케팅 워크플로우를 구축하세요.',
    description: '홈 히어로 리드(복도 미선택)',
  },
  {
    key: 'home.hero.lead_filtered',
    value:
      '{{category}} 복도입니다. 콘텐츠 탭으로 전체나 다른 복도를 전환할 수 있습니다.',
    description: '홈 히어로 리드(복도 선택). {{category}} 치환',
  },
  {
    key: 'home.hero.cta_primary',
    value: '프롬프트 역분석 시작하기',
    description: '홈 히어로 주요 CTA',
  },

  // 메인 히어로 캐러셀 (HomeMainHero)
  {
    key: 'home.main_hero.heading_en',
    value: 'The Gateway to AI Creativity.',
    description: '메인 히어로 영문 헤드라인',
  },
  {
    key: 'home.main_hero.sub_ko',
    value: '실험부터 출시까지, AI 프로젝트의 모든 복도(Aisles)가 모이는 곳.',
    description: '메인 히어로 한글 서브',
  },
  {
    key: 'home.main_hero.carousel.0.title',
    value: '오늘의 추천 레시피',
    description: '캐러셀 1 제목',
  },
  {
    key: 'home.main_hero.carousel.0.sub',
    value: 'Lab 복도에서 에디터가 고른 프롬프트·워크플로를 확인해 보세요.',
    description: '캐러셀 1 부제',
  },
  {
    key: 'home.main_hero.carousel.1.title',
    value: '이달의 베스트 프로젝트',
    description: '캐러셀 2 제목',
  },
  {
    key: 'home.main_hero.carousel.1.sub',
    value: 'Launch와 Build에서 반응이 뜨거웠던 작품과 빌드 노트를 모았습니다.',
    description: '캐러셀 2 부제',
  },
  {
    key: 'home.main_hero.carousel.2.title',
    value: '갤러리 신작 하이라이트',
    description: '캐러셀 3 제목',
  },
  {
    key: 'home.main_hero.carousel.2.sub',
    value: 'Gallery에서 비주얼 트렌드와 아이디어 스파크를 수집하세요.',
    description: '캐러셀 3 부제',
  },
  { key: 'home.main_hero.cta', value: 'Explore Now', description: '메인 히어로 하단 CTA' },

  // 오늘의 베스트
  { key: 'home.todays_best.title', value: '오늘의 베스트', description: '사이드 위젯 제목' },

  // 퀘이사 보드
  { key: 'home.quasar.ai_work.title', value: 'AI Work', description: '퀘이사 메인 섹션 제목' },
  {
    key: 'home.quasar.ai_work.subtitle',
    value: 'Lab·Gallery 최신 글',
    description: '퀘이사 메인 부제',
  },
  {
    key: 'home.quasar.prompt_register',
    value: '나만의 프롬프트 등록',
    description: '퀘이사 등록 버튼 텍스트',
  },
  {
    key: 'home.quasar.prompt_register_aria',
    value: '나만의 프롬프트 등록',
    description: '퀘이사 등록 버튼 aria-label',
  },
  { key: 'home.quasar.more_lab', value: 'LAB', description: 'LAB 더보기 링크 라벨' },
  { key: 'home.quasar.more_gallery', value: 'GALLERY', description: 'GALLERY 더보기 링크 라벨' },
  {
    key: 'home.quasar.empty',
    value: '아직 노출할 글이 없습니다.',
    description: '퀘이사 빈 상태',
  },
  {
    key: 'home.quasar.aside_aria',
    value: 'AI 트렌드·커뮤니티 최신',
    description: '퀘이사 우측 사이드 aside aria-label',
  },

  // 컴포지트(지연 로드 섹션)
  { key: 'home.composite.ai_work.title', value: 'AI Work', description: '컴포지트 AI Work 제목' },
  {
    key: 'home.composite.ai_work.subtitle',
    value: 'Lab·Gallery 인기 글',
    description: '컴포지트 AI Work 부제',
  },
  {
    key: 'home.composite.community.title',
    value: 'Community',
    description: '컴포지트 커뮤니티 제목',
  },
  {
    key: 'home.composite.community.subtitle',
    value: 'AI 트렌드·커뮤니티 최신 글',
    description: '컴포지트 커뮤니티 부제',
  },
  {
    key: 'home.composite.empty',
    value: '아직 노출할 글이 없습니다.',
    description: '컴포지트 빈 상태',
  },
  { key: 'home.composite.empty_col', value: '글이 없습니다.', description: '컬럼 빈 상태' },

  // 하단 피드 레이아웃
  { key: 'home.section.launch_heading', value: 'LAUNCH', description: '런치 슬라이더 섹션 제목' },
  { key: 'home.section.all_feed_heading', value: 'ALL', description: '전체 피드 섹션 제목' },
  {
    key: 'home.launch_slider.badge',
    value: 'Launch',
    description: '런치 슬라이더 배지',
  },
  {
    key: 'home.launch_slider.aria_section',
    value: 'Launch 최신',
    description: '런치 슬라이더 섹션 aria-label',
  },
  {
    key: 'home.launch_slider.aria_slide',
    value: '{{n}}번째 Launch 글',
    description: '런치 슬라이드 도트 aria. {{n}} 치환',
  },

  // 최근 게시물
  { key: 'home.recent.title', value: '최근 게시물', description: '사이드 최근 글 제목' },
  {
    key: 'home.recent.empty',
    value: '아직 게시글이 없습니다.',
    description: '최근 글 빈 상태 (업로드 링크 앞)',
  },
] as const;

/** 시드/폴백용 key → value 맵 */
export function defaultUiLabelMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const row of UI_CONFIG_SEED) {
    m[row.key] = row.value;
  }
  return m;
}

/** 정적 폴백 — 클라이언트·SSR 초기값 (DB와 동기화하려면 UiLabelsProvider 사용) */
export function defaultPostCategoryOptions(): { value: Category; label: string }[] {
  const D = defaultUiLabelMap();
  return POST_CATEGORY_ORDER.map((value) => ({
    value,
    label: D[CATEGORY_TO_UI_KEY[value]] ?? value,
  }));
}
