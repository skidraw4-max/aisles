import type { Metadata } from 'next';
import { SiteFooter } from '@/components/SiteFooter';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';

export const metadata: Metadata = {
  title: 'AIsles Jury',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

export default function JuryLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
