import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';

/** /about 소개 페이지용 Schema.org WebPage JSON-LD */
export function buildAboutPageJsonLd(): Record<string, unknown> {
  const siteUrl = getCanonicalSiteUrl().replace(/\/$/, '');
  const aboutUrl = `${siteUrl}/about`;

  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': aboutUrl,
    url: aboutUrl,
    name: 'AIsle Hub 소개 — AI 뉴스 한글 요약 서비스',
    description:
      'AIsle Hub는 해커뉴스, 긱뉴스 등 글로벌 AI·테크 뉴스를 Gemini로 한국어 요약하는 서비스입니다. AI LAB, 갤러리, AI 커뮤니티를 함께 제공합니다.',
    inLanguage: 'ko-KR',
    isPartOf: {
      '@type': 'WebApplication',
      name: 'AIsle Hub',
      url: siteUrl,
    },
    about: {
      '@type': 'Thing',
      name: 'AI 뉴스 한글 요약',
      description: 'Hacker News, GeekNews, Lobsters, Techmeme, The Verge, MIT News, AI Breakfast, YouTube AI 채널',
    },
    publisher: {
      '@type': 'Organization',
      name: 'AIsle',
      url: siteUrl,
    },
  };
}
