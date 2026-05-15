'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/AuthModal';
import { createClient } from '@/lib/supabase/client';

export function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

const AUTH_CALLBACK_EMAIL_ERROR =
  '이메일 인증 링크가 만료되었거나 이미 사용되었습니다. 다시 로그인하거나 회원가입 후 새 인증 메일을 받아 주세요.';

const OAUTH_RETURN_SUCCESS = '로그인되었습니다. 환영합니다!';

function loginNoticeFromParams(error: string | null) {
  if (error === 'auth_callback') {
    return {
      type: 'err' as const,
      text: AUTH_CALLBACK_EMAIL_ERROR,
    };
  }
  return null;
}

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');

  const [resolvedAuthCallbackNotice, setResolvedAuthCallbackNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const effectiveNotice = useMemo(() => {
    if (errorParam === 'auth_callback') {
      return resolvedAuthCallbackNotice;
    }
    return loginNoticeFromParams(errorParam);
  }, [errorParam, resolvedAuthCallbackNotice]);

  useEffect(() => {
    if (errorParam !== 'auth_callback') return;

    let cancelled = false;
    let navigateTimer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const {
        data: { session },
      } = await createClient().auth.getSession();
      if (cancelled) return;

      if (session) {
        setResolvedAuthCallbackNotice({ type: 'ok', text: OAUTH_RETURN_SUCCESS });
        navigateTimer = setTimeout(() => {
          router.replace(next);
          router.refresh();
        }, 900);
      } else {
        setResolvedAuthCallbackNotice({ type: 'err', text: AUTH_CALLBACK_EMAIL_ERROR });
      }
    })();

    return () => {
      cancelled = true;
      if (navigateTimer !== undefined) clearTimeout(navigateTimer);
    };
  }, [errorParam, next, router]);

  return (
    <AuthModal
      open
      onClose={() => router.push('/')}
      onAuthed={() => {
        router.push(next);
        router.refresh();
      }}
      initialNotice={effectiveNotice}
    />
  );
}
