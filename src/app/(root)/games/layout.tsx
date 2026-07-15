import type { Metadata } from 'next';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';

export const metadata: Metadata = {
  title: '게임 · AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export default function GamesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
