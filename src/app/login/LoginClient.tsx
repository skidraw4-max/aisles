'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AuthModal } from '@/components/AuthModal';

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));

  return (
    <AuthModal
      open
      onClose={() => router.push('/')}
      onAuthed={() => {
        router.push(next);
        router.refresh();
      }}
    />
  );
}
