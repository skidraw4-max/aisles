import { Suspense } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { LoginClient } from './LoginClient';

export const metadata = {
  title: '로그인 — AIsle',
};

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <Suspense fallback={null}>
        <LoginClient />
      </Suspense>
    </>
  );
}
