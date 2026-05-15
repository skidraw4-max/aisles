import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginClient } from './LoginClient';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';

export const metadata: Metadata = {
  title: '로그인 — AIsle',
  robots: SEO_ROBOTS_PRIVATE,
};

export default function LoginPage() {
  return (
    <>
      <Suspense fallback={null}>
        <LoginClient />
      </Suspense>
    </>
  );
}
