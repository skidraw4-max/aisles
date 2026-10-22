import type { Metadata } from 'next';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';

export const metadata: Metadata = {
  robots: SEO_ROBOTS_PRIVATE,
};

export default function AuthGroupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
