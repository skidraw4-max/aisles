import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { AboutPageClient } from './AboutPageClient';

export const metadata: Metadata = {
  title: '소개 — AIsleHub',
  description:
    'AIsleHub는 AI 프롬프트와 설정을 레시피로 구조화해 공유하는 플랫폼입니다. Gallery, LAB, Lounge, Build 복도와 제작 동기를 소개합니다.',
  openGraph: {
    title: '소개 — AIsleHub',
    description: 'AI 프롬프트 레시피 플랫폼 AIsleHub의 제작 동기와 복도 안내.',
    url: 'https://aisleshub.com/about',
  },
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <AboutPageClient />
      <SiteFooter />
    </>
  );
}
