import { ImageResponse } from 'next/og';
import { NextResponse } from 'next/server';
import { loadOgFontData } from '@/lib/og-font';
import { ogStaticFallbackResponse } from '@/lib/og-fallback-response';
import { getGame } from '@/lib/games/catalog';
import {
  defaultMode,
  formatScore,
  isGameSlug,
  isValidMode,
  modeLabel,
} from '@/lib/games/ranking';
import { fetchRankings } from '@/lib/games/ranking-store';

export const runtime = 'nodejs';

const OG_W = 1200;
const OG_H = 630;
const OG_CACHE = 'public, max-age=600, s-maxage=600, stale-while-revalidate=3600';
const OG_NOINDEX = { 'X-Robots-Tag': 'noindex' };

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
): Promise<ImageResponse | NextResponse> {
  try {
    return await renderGameScoreOg(req, ctx);
  } catch (error) {
    console.error('[og/games] unhandled', {
      error: error instanceof Error ? error.message : String(error),
    });
    return ogStaticFallbackResponse();
  }
}

async function renderGameScoreOg(
  req: Request,
  ctx: { params: Promise<{ slug: string }> }
): Promise<ImageResponse | NextResponse> {
  const { slug } = await ctx.params;
  if (!isGameSlug(slug)) {
    return ogStaticFallbackResponse();
  }
  const game = getGame(slug);
  if (!game) return ogStaticFallbackResponse();

  const url = new URL(req.url);
  const modeRaw = url.searchParams.get('mode')?.trim() || defaultMode(slug);
  const mode = isValidMode(slug, modeRaw) ? modeRaw : defaultMode(slug);
  const period = url.searchParams.get('period') === 'overall' ? 'overall' : 'weekly';

  const rankings = await fetchRankings({
    gameSlug: slug,
    mode,
    period,
    limit: 5,
  });

  const fontData = await loadOgFontData();
  if (!fontData) {
    return ogStaticFallbackResponse();
  }

  const periodLabel = period === 'weekly' ? '주간' : '전체';
  const top = rankings.entries[0];
  const headline = top
    ? `${periodLabel} 1위 · ${top.username}`
    : `${game.title} · ${periodLabel} 랭킹`;
  const scoreLine = top ? formatScore(top.score) : '아직 기록이 없습니다';
  const modeLine = `${modeLabel(mode)} 모드`;

  const rows = rankings.entries.slice(0, 5).map((e) => ({
    label: `${e.rank}. ${e.username}`,
    score: formatScore(e.score),
  }));

  try {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            color: '#fff',
            fontFamily: 'Pretendard',
            padding: '48px 56px',
            boxSizing: 'border-box',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.72)' }}>
              AIsle Games · {game.title}
            </div>
            <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {headline}
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: '#38bdf8' }}>{scoreLine}</div>
            <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.8)' }}>{modeLine}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <div
                key={r.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 26,
                  fontWeight: 600,
                  opacity: 0.92,
                }}
              >
                <span>{r.label}</span>
                <span>{r.score}</span>
              </div>
            ))}
            {rows.length === 0 ? (
              <div style={{ fontSize: 24, opacity: 0.7 }}>플레이 후 랭킹에 이름을 올려 보세요</div>
            ) : null}
          </div>
        </div>
      ),
      {
        width: OG_W,
        height: OG_H,
        fonts: [{ name: 'Pretendard', data: fontData, style: 'normal', weight: 700 }],
        headers: { 'Cache-Control': OG_CACHE, ...OG_NOINDEX },
      }
    );
  } catch (error) {
    console.error('[og/games] render_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return ogStaticFallbackResponse();
  }
}
