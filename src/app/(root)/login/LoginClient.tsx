'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/AuthModal';
import { createClient } from '@/lib/supabase/client';
import { accountEmailConflictNotice, authCallbackFailureText } from '@/lib/auth/account-email-conflict';
import { safeRelativePath } from '@/lib/auth/auth-redirect';

export function safeNextPath(raw: string | null): string {
  return safeRelativePath(raw, '/');
}

const OAUTH_RETURN_SUCCESS = '로그인되었습니다. 환영합니다!';

function loginNoticeFromParams(error: string | null) {
  const callbackText = authCallbackFailureText(error);
  if (callbackText) {
    return {
      type: 'err' as const,
      text: callbackText,
    };
  }
  return accountEmailConflictNotice(error);
}

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));
  const errorParam = searchParams.get('error');
  const signupParam = searchParams.get('signup');
  const initialMode =
    signupParam === '1' || signupParam === 'true' ? ('signup' as const) : ('login' as const);

  const [resolvedAuthCallbackNotice, setResolvedAuthCallbackNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const effectiveNotice = useMemo(() => {
    if (authCallbackFailureText(errorParam)) {
      return resolvedAuthCallbackNotice;
    }
    return loginNoticeFromParams(errorParam);
  }, [errorParam, resolvedAuthCallbackNotice]);

  useEffect(() => {
    const failureText = authCallbackFailureText(errorParam);
    if (!failureText) return;

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
        setResolvedAuthCallbackNotice({ type: 'err', text: failureText });
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
      initialMode={initialMode}
      initialNotice={effectiveNotice}
    />
  );
}
