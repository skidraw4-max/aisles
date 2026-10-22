'use client';

import nextDynamic from 'next/dynamic';

export const PostScrollSubscribeModal = nextDynamic(
  () => import('./PostScrollSubscribeModal').then((m) => ({ default: m.PostScrollSubscribeModal })),
  { ssr: false }
);
