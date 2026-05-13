/**
 * LOUNGE 뉴스 다이제스트 메일 발송
 *
 * - 환경: `CRON_SECRET`(필수), `RESEND_API_KEY`, `EMAIL_FROM`
 * - `GET` 또는 `POST` 동일 동작. `?frequency=weekly` 로 주간 다이제스트 발송.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { DigestFrequency } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { sendEmail } from '@/lib/email';

export const maxDuration = 60;

const MAX_RECIPIENTS_PER_RUN = 100;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/news-digest] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function parseFrequency(req: NextRequest): DigestFrequency {
  return req.nextUrl.searchParams.get('frequency')?.toLowerCase() === 'weekly' ? 'WEEKLY' : 'DAILY';
}

function sinceForFrequency(frequency: DigestFrequency): Date {
  const days = frequency === 'WEEKLY' ? 7 : 1;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function stripForEmail(content: string | null | undefined): string {
  return (content ?? '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderDigestEmail(
  posts: Array<{ id: string; title: string; content: string | null; createdAt: Date }>,
  frequency: DigestFrequency,
) {
  const siteUrl = getCanonicalSiteUrl();
  const label = frequency === 'WEEKLY' ? '주간' : '데일리';
  const itemsHtml = posts
    .map((post) => {
      const url = new URL(`/post/${post.id}`, `${siteUrl}/`).href;
      const summary = stripForEmail(post.content).slice(0, 160);
      return `<li style="margin:0 0 18px"><a href="${url}" style="font-weight:700;color:#6d5dfc;text-decoration:none">${post.title}</a>${
        summary ? `<p style="margin:6px 0 0;color:#444;line-height:1.5">${summary}</p>` : ''
      }</li>`;
    })
    .join('');

  const lines = posts.map((post, index) => {
    const url = new URL(`/post/${post.id}`, `${siteUrl}/`).href;
    const summary = stripForEmail(post.content).slice(0, 160);
    return `${index + 1}. ${post.title}\n${url}${summary ? `\n${summary}` : ''}`;
  });

  return {
    subject: `${label} AI 트렌드 다이제스트`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111"><h1 style="font-size:22px;margin:0 0 12px">AIsle ${label} AI 트렌드</h1><p style="margin:0 0 22px;color:#555">최근 LOUNGE에 올라온 AI 트렌드 글을 모았어요.</p><ol style="padding-left:20px;margin:0">${itemsHtml}</ol><p style="margin:24px 0 0;color:#777;font-size:13px">구독 설정은 로그인 후 AIsle에서 변경할 수 있습니다.</p></div>`,
    text: `AIsle ${label} AI 트렌드\n\n최근 LOUNGE에 올라온 AI 트렌드 글을 모았어요.\n\n${lines.join(
      '\n\n',
    )}\n\n구독 설정은 로그인 후 AIsle에서 변경할 수 있습니다.`,
  };
}

async function handle(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json(
      {
        ok: false,
        step: 'auth',
        error: 'UNAUTHORIZED',
        message: 'CRON_SECRET이 없거나 Authorization: Bearer 가 일치하지 않습니다.',
      },
      { status: 401 },
    );
  }

  const frequency = parseFrequency(req);
  const since = sinceForFrequency(frequency);
  const posts = await prisma.post.findMany({
    where: {
      category: 'LOUNGE',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: { id: true, title: true, content: true, createdAt: true },
  });

  if (posts.length === 0) {
    return NextResponse.json({ ok: true, frequency, sent: 0, skipped: 'no_recent_posts' });
  }

  const subscribers = await prisma.user.findMany({
    where: {
      newsletterSubscribed: true,
      digestFrequency: frequency,
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECIPIENTS_PER_RUN,
    select: { email: true },
  });

  const email = renderDigestEmail(posts, frequency);
  let sent = 0;
  const failures: Array<{ email: string; error: string; status?: number }> = [];

  for (const subscriber of subscribers) {
    const result = await sendEmail({
      to: subscriber.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (result.ok) {
      sent += 1;
    } else {
      failures.push({ email: subscriber.email, error: result.error, status: result.status });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    frequency,
    recentPosts: posts.length,
    subscribers: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 5),
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
