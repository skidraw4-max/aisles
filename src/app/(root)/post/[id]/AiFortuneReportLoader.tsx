'use client';

import nextDynamic from 'next/dynamic';

export const AiFortuneReport = nextDynamic(
  () => import('./AiFortuneReport').then((m) => ({ default: m.AiFortuneReport })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{ minHeight: '24rem' }}
        aria-busy="true"
        role="status"
        aria-label="AI FORTUNE 리포트 로딩"
      />
    ),
  }
);
