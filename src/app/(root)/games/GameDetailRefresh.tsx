'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refresh RSC payload after returning from /play so ranking snippets stay fresh. */
export function GameDetailRefresh() {
  const router = useRouter();
  useEffect(() => {
    router.refresh();
  }, [router]);
  return null;
}
