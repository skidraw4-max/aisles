'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/AuthModal';

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function loginNoticeFromParams(error: string | null) {
  if (error === 'auth_callback') {
    return {
      type: 'err' as const,
      text: '이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 다시 로그인하거나 회원가입 후 새 인증 메일을 받아 주세요.',
    };
  }
  return null;
}

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');
  const initialNotice = useMemo(() => loginNoticeFromParams(errorParam), [errorParam]);

  return (
    <AuthModal
      open
      onClose={() => router.push('/')}
      onAuthed={() => {
        router.push(next);
        router.refresh();
      }}
      initialNotice={initialNotice}
    />
  );
}
