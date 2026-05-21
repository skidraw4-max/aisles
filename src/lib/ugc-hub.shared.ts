import type { Category } from '@prisma/client';

export type LaunchBannerAdminRow = {
  id: string;
  title: string;
  featuredOnHome: boolean;
  launchBannerUntil: string | null;
  createdAt: string;
  views: number;
  likeCount: number;
  hasThumbnail: boolean;
};

/** metadata.params 내 도구·태그 필터 키 추출 */
export function extractBuildFilterKeys(params: unknown): string[] {
  if (!params || typeof params !== 'object' || params === null) return [];
  const o = params as Record<string, unknown>;
  const keys: string[] = [];
  if (typeof o.tool === 'string' && o.tool.trim()) keys.push(o.tool.trim());
  if (typeof o.buildTool === 'string' && o.buildTool.trim()) keys.push(o.buildTool.trim());
  if (Array.isArray(o.tools)) {
    for (const t of o.tools) {
      if (typeof t === 'string' && t.trim()) keys.push(t.trim());
    }
  }
  return [...new Set(keys)];
}

export function isUgcHubCategory(category: Category | null): category is 'BUILD' | 'LAUNCH' {
  return category === 'BUILD' || category === 'LAUNCH';
}
