/** Home feed resilience helpers — empty SSR recovery + payload clip. */

export const FEED_CONTENT_SNIPPET_MAX = 200;

export function shouldClientRetryEmptyFeed(opts: {
  postsLength: number;
  alreadyRetried: boolean;
}): boolean {
  return opts.postsLength === 0 && !opts.alreadyRetried;
}

/** Trim feed body before cache/RSC so LOUNGE payloads stay small. */
export function clipHomeFeedContent(content: string | null | undefined): string | null {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed.length <= FEED_CONTENT_SNIPPET_MAX) return trimmed;
  return `${trimmed.slice(0, FEED_CONTENT_SNIPPET_MAX)}…`;
}
