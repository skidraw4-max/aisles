'use client';

import type { ReactNode } from 'react';
import type { AiFortuneWeeklyPayload } from '@/lib/ai-fortune/payload';
import { AiFortuneReport } from './AiFortuneReportLoader';
import { usePostViewer } from './PostViewerContext';

type Props = {
  title: string;
  weekLabel: string;
  authorUsername: string;
  createdAt: Date;
  payload: AiFortuneWeeklyPayload;
  engagement: ReactNode;
};

export function AiFortuneReportWithViewer(props: Props) {
  const { userMbti } = usePostViewer();
  return <AiFortuneReport {...props} userMbti={userMbti} />;
}
