import type { Category } from '@prisma/client';

export type CorridorSeoMeta = {
  title: string;
  description: string;
};

/**
 * 복도(`/?category=`) unique SEO — AI_FORTUNE 품질을 다른 crawlable 복도에 확장.
 * TREND는 메뉴 비노출 레거시라 null(호출부에서 라벨 fallback).
 */
const CORRIDOR_SEO: Partial<Record<Category, CorridorSeoMeta>> = {
  RECIPE: {
    title: 'LAB — AI 프롬프트 연구소 · 역설계 레시피 | AIsle',
    description:
      '검증된 AI 프롬프트 레시피와 역설계·워크플로우를 모은 AIsle LAB입니다. 이미지·카피 프롬프트를 분석하고 바로 활용할 수 있는 실전 가이드를 찾아보세요.',
  },
  GALLERY: {
    title: 'GALLERY — AI 쇼케이스 · 창작 결과물 | AIsle',
    description:
      '커뮤니티가 만든 AI 창작 결과물을 모아 보는 AIsle 쇼케이스입니다. 이미지·영상·실험작을 둘러보고 영감을 얻거나 자신의 작품을 공유해 보세요.',
  },
  LOUNGE: {
    title: 'LOUNGE — AI 트렌드 뉴스·인사이트 | AIsle',
    description:
      '글로벌 AI 뉴스와 핵심 인사이트를 한곳에 모은 AIsle AI 트렌드 복도입니다. 바쁜 하루에도 놓치기 쉬운 변화를 빠르게 훑어보세요.',
  },
  GOSSIP: {
    title: 'GOSSIP — AI 커뮤니티 이야기 | AIsle',
    description:
      'AI 도구·프롬프트·사이드 프로젝트에 대한 가벼운 이야기와 Q&A가 오가는 AIsle 커뮤니티 복도입니다. 질문하고 경험을 나눠 보세요.',
  },
  BUILD: {
    title: 'BUILD — AI 제작기 · 레시피 공유 | AIsle',
    description:
      '실제로 만든 AI 제품·자동화·프롬프트 레시피를 공유하는 AIsle BUILD 복도입니다. 이번 주 인기 레시피를 보고 나만의 제작기를 올려 보세요.',
  },
  LAUNCH: {
    title: 'LAUNCH — AI 출시·런칭 보드 | AIsle',
    description:
      '새롭게 출시한 AI 서비스와 사이드 프로젝트를 소개하는 AIsle LAUNCH 보드입니다. 런칭 소식을 알리거나 다른 메이커의 출시작을 발견해 보세요.',
  },
  AI_FORTUNE: {
    title: 'AI FORTUNE — AI로 보는 주간 운세 및 커리어 가이드',
    description:
      '지난주 글로벌 AI 트렌드와 MBTI 16유형별 AI 활용 전략·행운의 키워드·피할 습관을 담은 AIsle 주간 운세 리포트입니다. 별도 가입 없이 전체 유형을 한눈에 볼 수 있습니다.',
  },
};

export function getCorridorSeoMeta(category: Category): CorridorSeoMeta | null {
  return CORRIDOR_SEO[category] ?? null;
}
