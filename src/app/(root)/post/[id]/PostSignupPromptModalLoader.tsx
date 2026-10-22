'use client';

import nextDynamic from 'next/dynamic';

export const PostSignupPromptModal = nextDynamic(
  () => import('./PostSignupPromptModal').then((m) => ({ default: m.PostSignupPromptModal })),
  { ssr: false }
);
