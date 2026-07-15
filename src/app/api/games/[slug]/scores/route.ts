import { NextRequest, NextResponse } from 'next/server';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { ensurePrismaUser } from '@/lib/ensure-user';
import { getGame, type GameSlug } from '@/lib/games/catalog';
import { fetchRankings, submitGameScore } from '@/lib/games/ranking-store';
import {
  defaultMode,
  isGameSlug,
  isValidMode,
  parseScoreSubmit,
  type RankingPeriod,
} from '@/lib/games/ranking';

type Ctx = { params: Promise<{ slug: string }> };

function parsePeriod(raw: string | null): RankingPeriod {
  return raw === 'overall' ? 'overall' : 'weekly';
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isGameSlug(slug) || !getGame(slug)) {
    return NextResponse.json({ error: 'Unknown game' }, { status: 404 });
  }
  const gameSlug = slug as GameSlug;
  const period = parsePeriod(req.nextUrl.searchParams.get('period'));
  const modeRaw = req.nextUrl.searchParams.get('mode') ?? defaultMode(gameSlug);
  if (!isValidMode(gameSlug, modeRaw)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  const limitRaw = Number(req.nextUrl.searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(limitRaw) ? limitRaw : 10;

  let viewerUserId: string | null = null;
  const auth = await getUserFromBearer(req);
  if (auth.ok) viewerUserId = auth.user.id;

  try {
    const data = await fetchRankings({
      gameSlug,
      mode: modeRaw,
      period,
      viewerUserId,
      limit,
    });
    return NextResponse.json(data);
  } catch (e) {
    console.error('[games/scores GET]', e);
    return NextResponse.json({ error: 'Failed to load rankings' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) return auth.response;

  const { slug } = await ctx.params;
  if (!isGameSlug(slug) || !getGame(slug)) {
    return NextResponse.json({ error: 'Unknown game' }, { status: 404 });
  }
  const gameSlug = slug as GameSlug;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = parseScoreSubmit(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (!isValidMode(gameSlug, parsed.mode)) {
    return NextResponse.json({ error: 'Invalid mode for this game' }, { status: 400 });
  }

  await ensurePrismaUser(auth.user);

  try {
    const result = await submitGameScore({
      userId: auth.user.id,
      gameSlug,
      mode: parsed.mode,
      score: parsed.score,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[games/scores POST]', e);
    return NextResponse.json({ error: 'Failed to save score' }, { status: 500 });
  }
}
