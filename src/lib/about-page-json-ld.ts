import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

const GEO_KEYWORDS = ['해커뉴스 요약', '긱뉴스 한국어 번역', 'IT 트렌드 다이제스트'] as const;

/** /about 소개 페이지용 Schema.org WebApplication JSON-LD */
export function buildAboutWebApplicationJsonLd(): Record<string, unknown> {
  const siteUrl = getCanonicalSiteUrl().replace(/\/$/, '');

  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${siteUrl}/#webapp`,
    name: 'AIsle Hub',
    alternateName: 'AIsle',
    url: siteUrl,
    applicationCategory: 'NewsApplication',
    description:
      'AIsle Hub는 해커뉴스(Hacker News), 긱뉴스(GeekNews) 등 글로벌 AI·테크 뉴스를 Gemini로 한국어 요약하는 웹·앱 서비스입니다. IT 트렌드 다이제스트, AI LAB, 갤러리, AI 커뮤니티를 함께 제공합니다.',
    keywords: [...GEO_KEYWORDS, 'AI 뉴스 한글 요약', 'GeekNews', 'Hacker News', 'Gemini 요약'].join(', '),
    featureList: [
      '해커뉴스 요약 — Hacker News 인기 AI·스타트업·개발 글 한글 요약 자동 동기화',
      '긱뉴스 한국어 번역 — GeekNews 인기 IT 글 한글 요약',
      'IT 트렌드 다이제스트 — Lobsters·Techmeme·The Verge·MIT News·AI Breakfast 뉴스 큐레이션',
      'YouTube AI 채널(MIT OCW, Google DeepMind 등) 영상 한글 요약',
      'AI NEWS / LOUNGE — 글로벌 AI·테크 뉴스 피드',
      'Gemini 기반 사실 중심 한국어 요약',
      'AI LAB — AI 프롬프트·설정 레시피 공유',
      '갤러리(GALLERY) — AI 비주얼 작품·역프롬프트',
      'AI 커뮤니티(GOSSIP)·제작기(BUILD)·출시(LAUNCH) 복도',
      'AI FORTUNE 주간 트렌드·MBTI별 커리어 리포트',
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
      '@id': `${siteUrl}/#organization`,
      name: 'AIsle',
      url: siteUrl,
    },
  };
}

/** /about 소개 페이지용 Schema.org Organization JSON-LD */
export function buildAboutOrganizationJsonLd(): Record<string, unknown> {
  const siteUrl = getCanonicalSiteUrl().replace(/\/$/, '');

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: 'AIsle',
    alternateName: 'AIsle Hub',
    url: siteUrl,
    description:
      'AIsle는 해커뉴스 요약, 긱뉴스 한국어 번역, IT 트렌드 다이제스트를 제공하는 AI·테크 미디어 허브를 운영합니다.',
    knowsAbout: [...GEO_KEYWORDS, 'AI 뉴스', 'Gemini', '프롬프트 레시피', 'AI 커뮤니티'],
    sameAs: [siteUrl],
  };
}

/** @deprecated Use buildAboutWebApplicationJsonLd + buildAboutOrganizationJsonLd */
export function buildAboutPageJsonLd(): Record<string, unknown> {
  return buildAboutWebApplicationJsonLd();
}
