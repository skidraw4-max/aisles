import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import {
  buildCommentNotifyEmail,
  shouldSendCommentNotify,
} from '@/lib/community-metrics/comment-notify';

function siteOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    'https://aisles.hub'
  );
}

/**
 * Best-effort: notify post author of a new comment (email, throttled).
 * Never throws to callers.
 */
export async function notifyPostAuthorOfComment(input: {
  postId: string;
  commenterId: string;
  commenterUsername: string;
  commentContent: string;
}): Promise<void> {
  try {
    const post = await prisma.post.findUnique({
      where: { id: input.postId },
      select: {
        id: true,
        title: true,
        authorId: true,
        author: { select: { id: true, email: true } },
      },
    });
    if (!post) return;

    const throttle = await prisma.commentNotifyThrottle.findUnique({
      where: {
        postId_authorId: { postId: post.id, authorId: post.authorId },
      },
    });

    const now = new Date();
    if (
      !shouldSendCommentNotify({
        postAuthorId: post.authorId,
        commenterId: input.commenterId,
        postAuthorEmail: post.author.email,
        lastSentAt: throttle?.lastSentAt ?? null,
        now,
      })
    ) {
      return;
    }

    const mail = buildCommentNotifyEmail({
      postTitle: post.title,
      postId: post.id,
      commenterUsername: input.commenterUsername,
      commentExcerpt: input.commentContent,
      siteOrigin: siteOrigin(),
    });

    const result = await sendEmail({
      to: post.author.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    if (!result.ok) {
      console.error('[comment-notify] send failed', result.error);
      return;
    }

    await prisma.commentNotifyThrottle.upsert({
      where: {
        postId_authorId: { postId: post.id, authorId: post.authorId },
      },
      create: {
        postId: post.id,
        authorId: post.authorId,
        lastSentAt: now,
      },
      update: { lastSentAt: now },
    });
  } catch (e) {
    console.error('[comment-notify]', e);
  }
}
