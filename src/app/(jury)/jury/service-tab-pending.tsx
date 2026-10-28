'use client';

/**
 * P5: ?tab= links stay on the same route segment, so loading.tsx never shows and the old area stays on screen until
 * the server render (화면 심사 is the heaviest) arrives — clicks looked ignored. Marks the clicked tab as pending.
 */
import { useLinkStatus } from 'next/link';

export function ServiceTabPending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <span role="status" aria-label="불러오는 중" data-testid="service-tab-pending">
      …
    </span>
  ) : null;
}
