import { isoWeekKey } from '@/lib/games/ranking';

/** Idempotent tag for weekly BUILD/LAUNCH digest posts. */
export function ugcWeeklyDigestTag(
  category: 'BUILD' | 'LAUNCH',
  weekKey: string = isoWeekKey()
): string {
  return `ugc-weekly:${category}:${weekKey}`;
}

export function parseUgcWeeklyDigestTag(
  tag: string
): { category: 'BUILD' | 'LAUNCH'; weekKey: string } | null {
  const m = /^ugc-weekly:(BUILD|LAUNCH):(\d{4}-W\d{2})$/.exec(tag.trim());
  if (!m) return null;
  return { category: m[1] as 'BUILD' | 'LAUNCH', weekKey: m[2]! };
}
