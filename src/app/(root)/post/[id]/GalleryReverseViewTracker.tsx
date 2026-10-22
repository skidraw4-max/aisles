'use client';

import { useEffect, useRef } from 'react';
import { trackGalleryReverseView } from '@/lib/ga4';

type Props = {
  postId: string;
  fromCache: boolean;
};

/** 역분석 UI 노출 1회 GA4 */
export function GalleryReverseViewTracker({ postId, fromCache }: Props) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    trackGalleryReverseView(postId, fromCache);
  }, [postId, fromCache]);
  return null;
}
