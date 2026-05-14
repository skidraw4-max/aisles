/**
 * LOUNGE 뉴스 다이제스트 메일 (KST 03·09·15·21시 슬롯, 각 6시간 구간)
 *
 * - 환경: `CRON_SECRET`(필수), `RESEND_API_KEY`, `EMAIL_FROM`
 * - `GET` 또는 `POST` 동일. `Authorization: Bearer ${CRON_SECRET}` 필수.
 * - 쿼리: `slot=0|1|2|3` 권장 (각 슬롯 종료 시각 KST: 03, 09, 15, 21시).
 *   생략 시 요청 시각의 UTC 시각에 가장 가까운 슬롯(18,0,6,12 UTC)으로 추정.
 * - 선택: `window=ISO_START,ISO_END` (반개구간 [start, end), slot보다 우선)
 *
 * 운영 스케줄: Vercel Cron은 사용하지 않고 `.github/workflows/news-digest-kst.yml`만 호출한다.
 *   UTC 정각 18·0·6·12시 → 각각 slot=0…3 POST, `Authorization: Bearer ${CRON_SECRET}` 필수.
 *   curl -sS -X POST "${CRON_SITE_URL}/api/cron/news-digest?slot=0" -H "Authorization: Bearer ${CRON_SECRET}"
 *   curl ... ?slot=1
 *   curl ... ?slot=2
 *   curl ... ?slot=3
 *
 * 슬롯별 권장 호출 (KST 기준 종료 시각 직후):
 *   slot=0 → 전일 21:00 ~ 당일 03:00 KST
 *   slot=1 → 03:00 ~ 09:00 KST
 *   slot=2 → 09:00 ~ 15:00 KST
 *   slot=3 → 15:00 ~ 21:00 KST
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { sendEmail } from '@/lib/email';
// 메일 제목: sendEmail() 내부에서 buildEmailSubject()로 [AIsle] 접두사 처리

export const maxDuration = 60;

const MAX_RECIPIENTS_PER_RUN = 100;

const SLOT_END_HOURS_KST = [3, 9, 15, 21] as const;

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

/** 반개구간 [start, end) — 각 슬롯은 6시간 폭, 종료 시각은 KST SLOT_END_HOURS_KST[slot]. */
function digestWindowForSlot(slot: 0 | 1 | 2 | 3, ref: Date): { start: Date; end: Date } {
  const { y, m, day } = kstYmd(ref);
  const endHour = SLOT_END_HOURS_KST[slot];
  const end = kstWallInstant(y, m, day, endHour, 0);
  const start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
  return { start, end };
}

function inferSlotFromUtcHour(utcH: number): 0 | 1 | 2 | 3 {
  const direct: Record<number, 0 | 1 | 2 | 3> = { 18: 0, 0: 1, 6: 2, 12: 3 };
  if (direct[utcH] !== undefined) return direct[utcH];
  const anchors = [18, 0, 6, 12];
  let bestIdx = 0;
  let bestDist = 24;
  for (let i = 0; i < 4; i++) {
    let d = Math.abs(utcH - anchors[i]);
    if (d > 12) d = 24 - d;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx as 0 | 1 | 2 | 3;
}

function parseSlotParam(req: NextRequest, ref: Date): 0 | 1 | 2 | 3 {
  const raw = req.nextUrl.searchParams.get('slot')?.trim();
  if (raw === '0' || raw === '1' || raw === '2' || raw === '3') return Number(raw) as 0 | 1 | 2 | 3;
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

function digestSubjectLine(slot: 0 | 1 | 2 | 3): string {
  const h = SLOT_END_HOURS_KST[slot];
  return `AI NEWS 다이제스트 (${String(h).padStart(2, '0')}시 KST 구간)`;
}

/** 뉴스레터 상단 브랜드 배너 (이메일 클라이언트 호환용 테이블 + 인라인 SVG) */
function digestEmailBannerHtml(siteUrl: string): string {
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
          <div style="font-size:28px;font-weight:800;color:#f8fafc;letter-spacing:-0.03em;line-height:1.05;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">AIsle</div>
          <div style="margin-top:8px;font-size:12px;color:#94a3b8;line-height:1.45;font-weight:500;max-width:260px;">The Island of AI Knowledge</div>
        </td>
        <td style="vertical-align:middle;padding:0 0 14px 12px;text-align:right;width:42%;">
          <a href="${siteUrl}/" style="display:inline-block;padding:10px 16px;border-radius:999px;background:rgba(255,255,255,0.1);border:1px solid rgba(148,197,255,0.45);color:#f1f5f9;font-size:10px;font-weight:700;letter-spacing:0.12em;text-decoration:none;font-family:system-ui,-apple-system,Segoe UI,sans-serif;">EXPLORE THE FULL ISLAND</a>
          <div style="margin-top:10px;font-size:11px;color:#7dd3fc;font-weight:600;letter-spacing:0.04em;">${host}</div>
        </td>
      </tr></table>
    </td>
  </tr>
  <tr>
    <td colspan="2" style="padding:0 12px 10px 12px;line-height:0;background:transparent;">${neuralSvg}</td>
  </tr>
</table>`;
}

function renderDigestEmail(
  posts: Array<{ id: string; title: string; content: string | null; createdAt: Date }>,
  slot: 0 | 1 | 2 | 3,
  windowLabel: string,
) {
  const siteUrl = getCanonicalSiteUrl();
  const subject = digestSubjectLine(slot);
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

  const bannerHtml = digestEmailBannerHtml(siteUrl);
  const digestHost = (() => {
    try {
      return new URL(siteUrl).hostname.replace(/^www\./i, '') || 'aisleshub.com';
    } catch {
      return 'aisleshub.com';
    }
  })();
  const digestIntro =
    '<p style="margin:0 0 16px;color:#475569;font-size:14px;font-weight:500;letter-spacing:0.01em;">Your digest of the latest AI trends</p>';

  return {
    subject,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111">${bannerHtml}${digestIntro}<h1 style="font-size:22px;margin:0 0 12px">AIsle AI NEWS</h1><p style="margin:0 0 8px;color:#555">수집 구간 (KST): ${windowLabel}</p><p style="margin:0 0 22px;color:#555">이번 구간에 등록된 AI NEWS 입니다.</p><ol style="padding-left:20px;margin:0">${itemsHtml}</ol><p style="margin:24px 0 0;color:#777;font-size:13px">구독 설정은 로그인 후 AIsle에서 변경할 수 있습니다.</p></div>`,
    text: `AIsle — The Island of AI Knowledge\nEXPLORE THE FULL ISLAND: ${siteUrl}/ (${digestHost})\n\nYour digest of the latest AI trends\n\nAIsle AI NEWS\n\n수집 구간 (KST): ${windowLabel}\n이번 구간에 등록된 AI NEWS 입니다.\n\n${lines.join(
      '\n\n',
    )}\n\n구독 설정은 로그인 후 AIsle에서 변경할 수 있습니다.`,
  };
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

  const posts = await prisma.post.findMany({
    where: {
      category: 'LOUNGE',
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { id: true, title: true, content: true, createdAt: true },
  });

  if (posts.length === 0) {
    return NextResponse.json({
      ok: true,
      slot,
      window: { start: start.toISOString(), end: end.toISOString() },
      sent: 0,
      skipped: 'no_posts_in_window',
    });
  }

  const subscribers = await prisma.user.findMany({
    where: { newsletterSubscribed: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECIPIENTS_PER_RUN,
    select: { email: true },
  });

  const email = renderDigestEmail(posts, slot, windowLabel);
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
