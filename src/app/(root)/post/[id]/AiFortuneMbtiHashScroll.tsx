'use client';

import { useEffect } from 'react';
import { parseMbtiType } from '@/lib/ai-fortune/mbti';

const HIGHLIGHT_MS = 2400;

/** URL hash `#INTJ` 등 MBTI 유형이 있으면 해당 카드로 스크롤·하이라이트 */
export function AiFortuneMbtiHashScroll() {
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '').trim();
    const type = parseMbtiType(raw);
    if (!type) return;

    const el = document.getElementById(`mbti-${type}`);
    if (!el) return;

    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('mbti-hash-highlight');
      window.setTimeout(() => el.classList.remove('mbti-hash-highlight'), HIGHLIGHT_MS);
    }, 120);

    return () => window.clearTimeout(t);
  }, []);

  return null;
}
