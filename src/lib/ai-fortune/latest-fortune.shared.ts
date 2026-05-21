import { aiFortunePayloadFromDb } from '@/lib/ai-fortune/payload';
import { formatAiFortuneWeekKeyLabel, getKstParts, weekOfMonthKst } from '@/lib/ai-fortune/kst-week';

export type LatestAiFortuneSummary = {
  id: string;
  title: string;
  subtitle: string;
  weekKey: string | null;
};

export function fortuneSubtitleFromPost(post: {
  title: string;
  createdAt: Date;
  aiFortuneWeekKey: string | null;
  aiFortunePayload: unknown;
}): string {
  const payload = aiFortunePayloadFromDb(post.aiFortunePayload);
  if (payload?.weekLabel?.trim()) return payload.weekLabel.trim();
  if (post.aiFortuneWeekKey) return formatAiFortuneWeekKeyLabel(post.aiFortuneWeekKey);
  const { year, month } = getKstParts(post.createdAt);
  return `${year}년 ${month}월 ${weekOfMonthKst(post.createdAt)}주차`;
}
