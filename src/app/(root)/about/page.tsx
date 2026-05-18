import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import { AboutPageClient } from './AboutPageClient';

const aboutPath = '/about';

export const metadata: Metadata = (() => {
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}${aboutPath}`;
  return {
    title: '소개 — AIsle',
    description:
      'AIsle은 AI 프롬프트·설정을 레시피로 공유하는 플랫폼입니다. 복도 안내, 로그인·업로드·검색 등 현재 기능을 소개합니다.',
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: {
      title: '소개 — AIsle',
      description: 'AIsle 제작 동기, 여섯 복도, 로그인·업로드·My Aisles 등 주요 기능 안내.',
      url,
    },
  };
})();

export default function AboutPage() {
  return (
    <>
      <AboutPageClient />
      <SiteFooter />
    </>
  );
}
