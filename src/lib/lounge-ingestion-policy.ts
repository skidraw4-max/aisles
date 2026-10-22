import { htmlToPlainText } from '@/lib/geeknews/extract-article-text';

/** 자동 수집 LOUNGE 본문 최소 길이(HTML 제거·공백 정규화 후) — 애드센스 품질 */
export const MIN_LOUNGE_BODY_CHARS = 400;

export function loungeBodyPlainLength(content: string): number {
  return htmlToPlainText(content).length;
}

export function meetsMinLoungeBodyLength(content: string): boolean {
  return loungeBodyPlainLength(content) >= MIN_LOUNGE_BODY_CHARS;
}

export type LoungeIngestionSkipContext = {
  source: string;
  title?: string;
  externalUrl?: string;
  videoId?: string;
  link?: string;
};

/** 자동 LOUNGE 게시 전 본문 길이 검사 — 미달 시 `false` 및 로그 */
export function shouldSkipThinLoungePost(
  content: string,
  ctx: LoungeIngestionSkipContext,
): boolean {
  const plainChars = loungeBodyPlainLength(content);
  if (plainChars >= MIN_LOUNGE_BODY_CHARS) return false;
  console.log('[lounge-ingestion] 본문 길이 부족 — 게시 스킵', {
    ...ctx,
    plainChars,
    min: MIN_LOUNGE_BODY_CHARS,
  });
  return true;
}
