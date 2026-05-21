/**
 * LOUNGE 뉴스 다이제스트 메일 (KST 06·18시 슬롯, 각 12시간 구간)
 *
 * - 환경: `CRON_SECRET`(필수), `RESEND_API_KEY`, `EMAIL_FROM`
 * - `GET` 또는 `POST` 동일. `Authorization: Bearer ${CRON_SECRET}` 필수.
 * - 쿼리: `slot=0|1` 권장 (각 슬롯 종료 시각 KST: 06, 18시).
 *   생략 시 요청 시각의 UTC 시각에 가장 가까운 슬롯(21,9 UTC)으로 추정.
 * - 선택: `window=ISO_START,ISO_END` (반개구간 [start, end), slot보다 우선)
 *
 * 운영 스케줄: Vercel Cron은 사용하지 않고 `.github/workflows/news-digest-kst.yml`만 호출한다.
 *   UTC 정각 21·9시 → 각각 slot=0·1 POST, `Authorization: Bearer ${CRON_SECRET}` 필수.
 *   curl -sS -X POST "${CRON_SITE_URL}/api/cron/news-digest?slot=0" -H "Authorization: Bearer ${CRON_SECRET}"
 *   curl ... ?slot=1
 *
 * 슬롯별 권장 호출 (KST 기준 종료 시각 직후):
 *   slot=0 → 전일 18:00 ~ 당일 06:00 KST
 *   slot=1 → 06:00 ~ 18:00 KST
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { sendEmail } from '@/lib/email';
// 메일 제목: sendEmail() 내부에서 buildEmailSubject()로 [AIsle] 접두사 처리

export const maxDuration = 60;

const MAX_RECIPIENTS_PER_RUN = 100;

/** LOUNGE 다이제스트 본문 최대 건수(에디터 픽 1건 포함). */
const DIGEST_LOUNGE_SLOT_MAX = 8;

type DigestPostRow = {
  id: string;
  title: string;
  content: string | null;
  createdAt: Date;
};

type DigestFortuneRow = {
  id: string;
  title: string;
  aiFortuneWeekKey: string | null;
};

type DigestSlot = 0 | 1;

const SLOT_END_HOURS_KST = [6, 18] as const;
const SLOT_WINDOW_HOURS = 12;

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn('[cron/news-digest] CRON_SECRET unset — refusing to run');
    return false;
  }
  const auth = req.headers.get('authorization')?.trim();
  return auth === `Bearer ${secret}`;
}

function kstYmd(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const g = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: g('year'), m: g('month'), day: g('day') };
}

function kstWallInstant(y: number, m: number, day: number, hour: number, min = 0): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return new Date(`${y}-${pad(m)}-${pad(day)}T${pad(hour)}:${pad(min)}:00+09:00`);
}

/** 반개구간 [start, end) — 각 슬롯은 12시간 폭, 종료 시각은 KST SLOT_END_HOURS_KST[slot]. */
function digestWindowForSlot(slot: DigestSlot, ref: Date): { start: Date; end: Date } {
  const { y, m, day } = kstYmd(ref);
  const endHour = SLOT_END_HOURS_KST[slot];
  const end = kstWallInstant(y, m, day, endHour, 0);
  const start = new Date(end.getTime() - SLOT_WINDOW_HOURS * 60 * 60 * 1000);
  return { start, end };
}

function inferSlotFromUtcHour(utcH: number): DigestSlot {
  const direct: Record<number, DigestSlot> = { 21: 0, 9: 1 };
  if (direct[utcH] !== undefined) return direct[utcH];
  const anchors = [21, 9];
  let bestIdx = 0;
  let bestDist = 24;
  for (let i = 0; i < 2; i++) {
    let d = Math.abs(utcH - anchors[i]);
    if (d > 12) d = 24 - d;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx as DigestSlot;
}

function parseSlotParam(req: NextRequest, ref: Date): DigestSlot {
  const raw = req.nextUrl.searchParams.get('slot')?.trim();
  if (raw === '0' || raw === '1') return Number(raw) as DigestSlot;
  return inferSlotFromUtcHour(ref.getUTCHours());
}

function parseWindowOverride(req: NextRequest): { start: Date; end: Date } | null {
  const raw = req.nextUrl.searchParams.get('window')?.trim();
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const start = new Date(parts[0]);
  const end = new Date(parts[1]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return null;
  return { start, end };
}

function stripForEmail(content: string | null | undefined): string {
  return (content ?? '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function digestUtmCampaign(slot: DigestSlot): 'digest_am' | 'digest_pm' {
  return slot === 0 ? 'digest_am' : 'digest_pm';
}

function buildDigestUrl(
  siteUrl: string,
  slot: DigestSlot,
  path: string,
  extra?: Record<string, string>,
): string {
  const base = siteUrl.replace(/\/$/, '');
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${base}/`);
  url.searchParams.set('utm_source', 'newsletter');
  url.searchParams.set('utm_medium', 'email');
  url.searchParams.set('utm_campaign', digestUtmCampaign(slot));
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      url.searchParams.set(k, v);
    }
  }
  return url.href;
}

function postDigestUrl(siteUrl: string, slot: DigestSlot, postId: string): string {
  return buildDigestUrl(siteUrl, slot, `/post/${postId}`);
}

function truncateForSubject(text: string, maxLen: number): string {
  const t = text.trim();
  if (t.length <= maxLen) return t;
  const slice = t.slice(0, maxLen - 1);
  const breakAt = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('·'));
  if (breakAt >= Math.floor(maxLen * 0.45)) return `${slice.slice(0, breakAt)}…`;
  return `${slice}…`;
}

/** sendEmail() → buildEmailSubject() 로 [AIsle] 접두사가 붙음. 모바일 제목은 ~40자 권장. */
function digestSubjectLine(slot: DigestSlot, topTitle?: string | null): string {
  const base = slot === 0 ? '☀️ 오늘 아침 AI 3분 요약' : '🌙 저녁 AI 핵심 브리핑';
  const headline = topTitle?.trim();
  if (!headline) return base;
  const maxHeadline = base.length + 3 >= 28 ? 18 : 22;
  return `${base} · ${truncateForSubject(headline, maxHeadline)}`;
}

function digestPreheader(slot: DigestSlot, posts: Array<{ title: string }>): string {
  const count = posts.length;
  const top = posts[0]?.title?.trim();
  const slotLabel = slot === 0 ? '아침' : '저녁';
  if (top) {
    return `${truncateForSubject(top, 48)} · LOUNGE AI 트렌드 ${count}건 (${slotLabel})`;
  }
  return `LOUNGE AI 트렌드 ${count}건 — ${slotLabel} 다이제스트`;
}

/** 뉴스레터 상단 브랜드 배너 (이메일 클라이언트 호환용 테이블 + 인라인 SVG) */
function digestEmailBannerHtml(siteUrl: string, slot: DigestSlot): string {
  const homeHref = buildDigestUrl(siteUrl, slot, '/', { utm_content: 'banner_home' });
  const linkT = 'target="_blank" rel="noopener noreferrer"';
  const host = (() => {
    try {
      return new URL(siteUrl).hostname.replace(/^www\./i, '') || 'aisleshub.com';
    } catch {
      return 'aisleshub.com';
    }
  })();
  const neuralSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="26" viewBox="0 0 600 26" preserveAspectRatio="none" role="presentation" style="display:block;opacity:0.9">
  <path d="M0 18 C90 6 180 22 270 14 S450 8 600 16" fill="none" stroke="rgba(147,197,253,0.28)" stroke-width="0.55"/>
  <path d="M0 22 C120 12 240 24 360 16 S480 20 600 14" fill="none" stroke="rgba(96,165,250,0.22)" stroke-width="0.45"/>
  <path d="M40 20 L95 12 L152 17 L210 9 L268 15" fill="none" stroke="rgba(186,230,253,0.2)" stroke-width="0.4"/>
  <circle cx="95" cy="12" r="1.1" fill="rgba(224,242,254,0.55)"/><circle cx="152" cy="17" r="0.9" fill="rgba(224,242,254,0.45)"/><circle cx="210" cy="9" r="1" fill="rgba(224,242,254,0.5)"/><circle cx="268" cy="15" r="0.85" fill="rgba(224,242,254,0.4)"/>
</svg>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto 18px;border-collapse:collapse;border-radius:14px;overflow:hidden;background-color:#071525;background-image:linear-gradient(135deg,#050f1f 0%,#0c2744 42%,#0a1e38 72%,#071a32 100%);">
  <tr>
    <td colspan="2" style="padding:0 20px 0 20px;padding-top:18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle;padding:0 12px 14px 0;width:58%;">
          <a href="${homeHref}" ${linkT} style="text-decoration:none;color:inherit;display:block;">
            <div style="font-size:28px;font-weight:800;color:#f8fafc;letter-spacing:-0.03em;line-height:1.05;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">AIsle</div>
            <div style="margin-top:8px;font-size:12px;color:#94a3b8;line-height:1.45;font-weight:500;max-width:260px;">The Island of AI Knowledge</div>
          </a>
        </td>
        <td style="vertical-align:middle;padding:0 0 14px 12px;text-align:right;width:42%;">
          <a href="${homeHref}" ${linkT} style="display:inline-block;padding:10px 16px;border-radius:999px;background:rgba(255,255,255,0.1);border:1px solid rgba(148,197,255,0.45);color:#f1f5f9;font-size:10px;font-weight:700;letter-spacing:0.12em;text-decoration:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">EXPLORE THE FULL ISLAND</a>
          <div style="margin-top:10px;"><a href="${homeHref}" ${linkT} style="font-size:11px;color:#7dd3fc;font-weight:600;letter-spacing:0.04em;text-decoration:none;">${host}</a></div>
        </td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0 12px 10px 12px;line-height:0;background:transparent;"><a href="${homeHref}" ${linkT} style="display:block;text-decoration:none;line-height:0;">${neuralSvg}</a></td>
  </tr>
</table>`;
}

function fortuneSectionHtml(
  fortune: DigestFortuneRow,
  siteUrl: string,
  slot: DigestSlot,
): string {
  const href = buildDigestUrl(siteUrl, slot, `/post/${fortune.id}`, {
    utm_content: 'fortune_week',
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:24px auto 0;border-collapse:collapse;border-radius:12px;border:1px solid rgba(57,255,20,0.35);background:linear-gradient(145deg,#071a0f 0%,#020804 100%);">
  <tr><td style="padding:18px 20px">
    <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#39ff14;letter-spacing:0.06em">🔮 이번 주 AI FORTUNE</p>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.45;color:#e8fff0"><a href="${href}" style="color:#7fff9a;font-weight:700;text-decoration:none">${fortune.title}</a></p>
    <a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:rgba(57,255,20,0.15);border:1px solid rgba(57,255,20,0.45);color:#39ff14;font-size:13px;font-weight:700;text-decoration:none">주간 운세 · MBTI 리포트 보기</a>
  </td></tr>
</table>`;
}

function renderDigestEmail(
  posts: DigestPostRow[],
  slot: DigestSlot,
  windowLabel: string,
  fortune: DigestFortuneRow | null,
) {
  const siteUrl = getCanonicalSiteUrl();
  const topPost = posts[0];
  const subject = digestSubjectLine(slot, topPost?.title);
  const preheader = digestPreheader(slot, posts);
  const loungeHref = buildDigestUrl(siteUrl, slot, '/', {
    category: 'LOUNGE',
    utm_content: 'cta_lounge',
  });
  const topStoryHref = topPost
    ? buildDigestUrl(siteUrl, slot, `/post/${topPost.id}`, { utm_content: 'cta_top' })
    : loungeHref;
  const manageHref = buildDigestUrl(siteUrl, slot, '/', {
    category: 'LOUNGE',
    utm_content: 'manage_subscription',
  });

  const itemsHtml = posts
    .map((post) => {
      const url = postDigestUrl(siteUrl, slot, post.id);
      const summary = stripForEmail(post.content).slice(0, 160);
      return `<li style="margin:0 0 18px"><a href="${url}" style="font-weight:700;color:#6d5dfc;text-decoration:none">${post.title}</a>${
        summary ? `<p style="margin:6px 0 0;color:#444;line-height:1.5">${summary}</p>` : ''
      }</li>`;
    })
    .join('');

  const lines = posts.map((post, index) => {
    const url = postDigestUrl(siteUrl, slot, post.id);
    const summary = stripForEmail(post.content).slice(0, 160);
    return `${index + 1}. ${post.title}\n${url}${summary ? `\n${summary}` : ''}`;
  });

  const bannerHtml = digestEmailBannerHtml(siteUrl, slot);
  const digestHost = (() => {
    try {
      return new URL(siteUrl).hostname.replace(/^www\./i, '') || 'aisleshub.com';
    } catch {
      return 'aisleshub.com';
    }
  })();
  const homeWithUtm = buildDigestUrl(siteUrl, slot, '/', { utm_content: 'text_home' });
  const slotEmoji = slot === 0 ? '☀️' : '🌙';
  const digestIntro = `<p style="margin:0 0 16px;color:#475569;font-size:14px;font-weight:500;letter-spacing:0.01em;">${slotEmoji} LOUNGE AI 트렌드 — 지난 12시간 핵심 ${posts.length}건</p>`;
  const ctaHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px"><tr>
  <td style="padding-right:10px"><a href="${topStoryHref}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#6d5dfc;color:#fff;font-weight:700;font-size:14px;text-decoration:none">오늘의 핵심 글 읽기</a></td>
  <td><a href="${loungeHref}" style="display:inline-block;padding:12px 18px;border-radius:10px;border:1px solid #cbd5e1;color:#334155;font-weight:600;font-size:14px;text-decoration:none">AI 트렌드 전체</a></td>
</tr></table>`;
  const fortuneHtml = fortune ? fortuneSectionHtml(fortune, siteUrl, slot) : '';
  const fortuneText = fortune
    ? `\n\n🔮 이번 주 AI FORTUNE\n${fortune.title}\n${buildDigestUrl(siteUrl, slot, `/post/${fortune.id}`, { utm_content: 'fortune_week' })}\n`
    : '';
  const preheaderHtml = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#f8fafc">${preheader}${'&#847; '.repeat(12)}</div>`;

  return {
    subject,
    html: `${preheaderHtml}<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">${bannerHtml}${digestIntro}<h1 style="font-size:22px;margin:0 0 12px">AIsle AI NEWS</h1><p style="margin:0 0 8px;color:#555">수집 구간 (KST): ${windowLabel}</p><p style="margin:0 0 22px;color:#555">이번 구간에 등록된 LOUNGE AI 트렌드입니다.</p><ol style="padding-left:20px;margin:0">${itemsHtml}</ol>${ctaHtml}${fortuneHtml}<p style="margin:20px 0 0;color:#777;font-size:13px;line-height:1.5"><a href="${manageHref}" style="color:#6d5dfc;text-decoration:none">구독 설정 변경</a> · 로그인 후 AI 트렌드(LOUNGE)에서 뉴스 구독을 켜거나 끌 수 있습니다.</p></div>`,
    text: `AIsle — The Island of AI Knowledge\n${preheader}\n\nEXPLORE: ${homeWithUtm} (${digestHost})\n\n${slotEmoji} LOUNGE AI 트렌드 — 지난 12시간 핵심 ${posts.length}건\n\nAIsle AI NEWS\n\n수집 구간 (KST): ${windowLabel}\n이번 구간에 등록된 LOUNGE AI 트렌드입니다.\n\n${lines.join(
      '\n\n',
    )}\n\n오늘의 핵심: ${topStoryHref}\nAI 트렌드 전체: ${loungeHref}\n구독 설정: ${manageHref}${fortuneText}`,
  };
}

/**
 * 글로벌 다이제스트(구독자 전원 동일 본문) LOUNGE 선정 규칙:
 * 1) 구간 내 likeCount 최상위 1건(스포트라이트)
 * 2) 나머지 슬롯은 LOUNGE 등록일 최신순(1번 제외)
 * 3) 여유 슬롯 1건은 BUILD/LAUNCH 최신 에디터 픽(구간 내)
 */
async function pickDigestLoungePosts(start: Date, end: Date): Promise<DigestPostRow[]> {
  const select = { id: true, title: true, content: true, createdAt: true } as const;

  const topLiked = await prisma.post.findFirst({
    where: { category: 'LOUNGE', createdAt: { gte: start, lt: end } },
    orderBy: [{ likeCount: 'desc' }, { createdAt: 'desc' }],
    select,
  });

  const chronological = await prisma.post.findMany({
    where: {
      category: 'LOUNGE',
      createdAt: { gte: start, lt: end },
      ...(topLiked ? { id: { not: topLiked.id } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: DIGEST_LOUNGE_SLOT_MAX,
    select,
  });

  const editorPick = await prisma.post.findFirst({
    where: {
      category: { in: ['BUILD', 'LAUNCH'] },
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: 'desc' },
    select,
  });

  const seen = new Set<string>();
  const merged: DigestPostRow[] = [];
  const push = (row: DigestPostRow | null | undefined) => {
    if (!row || seen.has(row.id)) return;
    seen.add(row.id);
    merged.push(row);
  };

  push(topLiked);
  for (const row of chronological) push(row);
  push(editorPick);

  return merged.slice(0, DIGEST_LOUNGE_SLOT_MAX);
}

async function fetchLatestFortuneForDigest(): Promise<DigestFortuneRow | null> {
  return prisma.post.findFirst({
    where: { category: 'AI_FORTUNE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, aiFortuneWeekKey: true },
  });
}

function formatKstRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${fmt.format(start)} ~ ${fmt.format(end)}`;
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

  const ref = new Date();
  const windowOverride = parseWindowOverride(req);
  const slot = parseSlotParam(req, ref);
  const { start, end } = windowOverride ?? digestWindowForSlot(slot, ref);
  const windowLabel = formatKstRange(start, end);

  const [posts, fortunePost] = await Promise.all([
    pickDigestLoungePosts(start, end),
    fetchLatestFortuneForDigest(),
  ]);

  if (posts.length === 0) {
    return NextResponse.json({
      ok: true,
      slot,
      window: { start: start.toISOString(), end: end.toISOString() },
      sent: 0,
      skipped: 'no_posts_in_window',
      fortuneIncluded: Boolean(fortunePost),
    });
  }

  const subscribers = await prisma.user.findMany({
    where: { newsletterSubscribed: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECIPIENTS_PER_RUN,
    select: { email: true },
  });

  const email = renderDigestEmail(posts, slot, windowLabel, fortunePost);
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
    slot,
    window: { start: start.toISOString(), end: end.toISOString() },
    postsInWindow: posts.length,
    fortuneIncluded: Boolean(fortunePost),
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
