'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { isJuryRequestPath } from '@/lib/jury-product/jury-url';

export function isJuryPath(pathname: string, host?: string | null): boolean {
  return isJuryRequestPath(pathname, host);
}

/** Jury routes render without the hub header, notices, and ads. */
export function RouteChrome({
  before,
  after,
  children,
}: {
  before: ReactNode;
  after: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const host = typeof window === 'undefined' ? null : window.location.host;
  if (isJuryPath(pathname, host)) return children;
  return (
    <>
      {before}
      {children}
      {after}
    </>
  );
}
