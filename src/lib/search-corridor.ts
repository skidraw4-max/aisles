import type { Category } from '@prisma/client';

/**
 * Search `corridor` query values.
 * UI "LAB" maps to Prisma `RECIPE`.
 */
export const SEARCH_CORRIDORS = [
  'LAB',
  'GALLERY',
  'LOUNGE',
  'BUILD',
  'LAUNCH',
  'AI_FORTUNE',
  'RECIPE',
] as const;

export type SearchCorridor = (typeof SEARCH_CORRIDORS)[number];

/** Map URL corridor token → Prisma Category */
export function searchCorridorToCategory(corridor: SearchCorridor): Category {
  if (corridor === 'LAB' || corridor === 'RECIPE') return 'RECIPE';
  return corridor;
}

export function parseSearchCorridor(raw: string | undefined): SearchCorridor | undefined {
  if (!raw?.trim()) return undefined;
  const k = raw.trim().toUpperCase();
  return (SEARCH_CORRIDORS as readonly string[]).includes(k)
    ? (k as SearchCorridor)
    : undefined;
}
