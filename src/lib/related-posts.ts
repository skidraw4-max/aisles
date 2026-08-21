/**
 * 관련글 후보 정렬 — 태그 교집합이 많을수록 우선, 동점이면 최신(createdAt desc).
 */
export type RelatedCandidate = {
  id: string;
  tags: string[];
  createdAt: Date | string;
};

export function tagOverlapScore(sourceTags: string[], candidateTags: string[]): number {
  if (!sourceTags.length || !candidateTags.length) return 0;
  const set = new Set(sourceTags.map((t) => t.toLowerCase()));
  let n = 0;
  for (const t of candidateTags) {
    if (set.has(t.toLowerCase())) n += 1;
  }
  return n;
}

export function rankRelatedCandidates(
  sourceTags: string[],
  candidates: RelatedCandidate[],
  take: number
): RelatedCandidate[] {
  const scored = candidates.map((c) => ({
    c,
    overlap: tagOverlapScore(sourceTags, c.tags),
    t: c.createdAt instanceof Date ? c.createdAt.getTime() : new Date(c.createdAt).getTime(),
  }));
  scored.sort((a, b) => {
    if (b.overlap !== a.overlap) return b.overlap - a.overlap;
    return b.t - a.t;
  });
  return scored.slice(0, Math.max(0, take)).map((s) => s.c);
}
