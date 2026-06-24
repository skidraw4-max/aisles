'use client';

import { useEffect } from 'react';
import { GA_MEASUREMENT_ID } from '@/lib/ga4';

/** 상세 페이지뷰에 `content_group` / `post_category` 설정 */
export function PostContentGroupAnalytics({ category }: { category: string }) {
  useEffect(() => {
    const gtag = window.gtag;
    if (typeof gtag !== 'function' || !GA_MEASUREMENT_ID) return;
    gtag('config', GA_MEASUREMENT_ID, {
      content_group: category,
      post_category: category,
    });
  }, [category]);

  return null;
}
