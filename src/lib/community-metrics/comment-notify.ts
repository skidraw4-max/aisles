const THROTTLE_MS = 10 * 60 * 1000;

export type CommentNotifyGateInput = {
  postAuthorId: string;
  commenterId: string;
  postAuthorEmail: string | null | undefined;
  lastSentAt: Date | null;
  now: Date;
};

export function shouldSendCommentNotify(input: CommentNotifyGateInput): boolean {
  if (input.postAuthorId === input.commenterId) return false;
  const email = input.postAuthorEmail?.trim();
  if (!email) return false;
  if (input.lastSentAt && input.now.getTime() - input.lastSentAt.getTime() < THROTTLE_MS) {
    return false;
  }
  return true;
}

export function buildCommentNotifyEmail(input: {
  postTitle: string;
  postId: string;
  commenterUsername: string;
  commentExcerpt: string;
  siteOrigin: string;
}): { subject: string; html: string; text: string } {
  const origin = input.siteOrigin.replace(/\/$/, '');
  const url = `${origin}/post/${input.postId}`;
  const excerpt = input.commentExcerpt.slice(0, 200);
  const subject = `새 댓글: ${input.postTitle.slice(0, 80)}`;
  const text = `${input.commenterUsername}님이 「${input.postTitle}」에 댓글을 남겼습니다.\n\n${excerpt}\n\n${url}`;
  const html = `<p><strong>${escapeHtml(input.commenterUsername)}</strong>님이 「${escapeHtml(input.postTitle)}」에 댓글을 남겼습니다.</p><blockquote>${escapeHtml(excerpt)}</blockquote><p><a href="${escapeHtml(url)}">게시글 보기</a></p>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
