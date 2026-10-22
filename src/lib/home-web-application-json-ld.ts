import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/** 홈(허브)용 Schema.org WebApplication JSON-LD — 생성형 검색 엔진(GEO) 식별용 */
export function buildHomeWebApplicationJsonLd(): Record<string, unknown> {
  const siteUrl = getCanonicalSiteUrl();

  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'AIsle Hub',
    alternateName: 'AIsle',
    url: siteUrl,
    applicationCategory: 'NewsApplication',
    description:
      'AIsle Hub는 AI·테크 뉴스를 한국어로 요약해 주는 웹·앱 서비스입니다. 해커뉴스(Hacker News), 긱뉴스(GeekNews), Lobsters, Techmeme, The Verge, MIT News, AI Breakfast, YouTube AI 채널 등에서 기사를 자동 수집하고 Gemini로 한글 요약을 제공합니다. AI LAB(프롬프트 레시피), 갤러리, AI 커뮤니티 복도도 함께 운영합니다.',
    featureList: [
      '해커뉴스(Hacker News) 한글 요약 자동 동기화',
      '긱뉴스(GeekNews) 한글 요약 자동 동기화',
      'Lobsters·Techmeme·The Verge·MIT News·AI Breakfast 뉴스 한글 요약',
      'YouTube AI 채널(MIT OCW, Google DeepMind 등) 영상 요약',
      'AI NEWS·LOUNGE 복도 — 글로벌 AI·테크 뉴스 피드',
      'Gemini 기반 사실 중심 한국어 요약',
      'AI LAB — AI 프롬프트·설정 레시피 공유',
      '갤러리 — AI 비주얼 작품·역프롬프트',
      'AI 커뮤니티·제작기(BUILD)·출시(LAUNCH) 복도',
      'AI FORTUNE 주간 운세·트렌드 리포트',
      '웹 브라우저 및 Android 앱 지원',
    ],
    operatingSystem: 'Web, Android',
    inLanguage: 'ko-KR',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'KRW',
    },
    publisher: {
      '@type': 'Organization',
      name: 'AIsle',
      url: siteUrl,
    },
  };
}
