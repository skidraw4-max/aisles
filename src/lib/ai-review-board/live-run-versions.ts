/**
 * Known baseline Live Gemini runs (v9.1 did not add a Live run — regression only).
 */
export const AI_REVIEW_BOARD_LIVE_VERSIONS: Record<
  string,
  { label: string; note?: string }
> = {
  'run-2026-09-17T07-53-24-323Z': { label: 'v1' },
  'run-2026-09-17T09-27-13-078Z': { label: 'v2/v3' },
  'run-2026-09-17T10-09-59-178Z': { label: 'v4' },
  'run-2026-09-17T10-34-21-451Z': { label: 'v5' },
  'run-2026-09-17T10-55-31-639Z': { label: 'v6' },
  'run-2026-09-17T11-15-53-412Z': { label: 'v6b' },
  'run-2026-09-17T11-33-12-976Z': { label: 'v7' },
  'run-2026-09-17T11-52-42-008Z': { label: 'v8 · Semantic Judge' },
  'run-2026-09-17T12-25-17-531Z': {
    label: 'v9 · Live (latest Gemini)',
    note: 'v9.1 = CASE-01…10 regression only — no new Live run',
  },
};

export function liveVersionLabel(runId: string): string | null {
  return AI_REVIEW_BOARD_LIVE_VERSIONS[runId]?.label ?? null;
}

export function liveVersionNote(runId: string): string | null {
  return AI_REVIEW_BOARD_LIVE_VERSIONS[runId]?.note ?? null;
}
