'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { restoreServiceTabUrl, serviceTabMemoryKey, type ServiceTab } from './service-detail-tabs-model';

/**
 * I-052: keeps the current tab across server-action redirects without changing the actions.
 * A form submit on the page remembers the tab; the redirected `?result=` page restores it once.
 */
export function ServiceTabMemory({ connectionId, tab }: { connectionId: string; tab: ServiceTab }) {
  const router = useRouter();
  React.useEffect(() => {
    const key = serviceTabMemoryKey(connectionId);
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(key);
    } catch {
      saved = null;
    }
    const next = restoreServiceTabUrl(window.location.href, saved);
    if (next) {
      try {
        window.sessionStorage.removeItem(key);
      } catch {}
      router.replace(next);
      return;
    }
    const onSubmit = () => {
      try {
        window.sessionStorage.setItem(key, tab);
      } catch {}
    };
    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, [connectionId, tab, router]);
  return null;
}
