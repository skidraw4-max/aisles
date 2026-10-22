import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';

export const metadata: Metadata = {
  robots: SEO_ROBOTS_PRIVATE,
};

/** 글쓰기는 /upload 로 통합 */
export default function WriteRedirectPage() {
  redirect('/upload');
}
