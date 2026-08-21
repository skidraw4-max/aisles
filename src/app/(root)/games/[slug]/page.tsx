import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GAME_LIST, getGame } from '@/lib/games/catalog';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
import { SEO_ROBOTS_PRIVATE, SEO_ROBOTS_PUBLIC } from '@/lib/seo-robots';
import { GameDetailRefresh } from '../GameDetailRefresh';
import { GameRankingBoard } from '../GameRankingBoard';
import { GameShareButton } from '../GameShareButton';
import styles from '../games.module.css';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GAME_LIST.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) {
    return { title: '게임 · AIsle', robots: SEO_ROBOTS_PRIVATE };
  }
  const base = getCanonicalSiteUrl().replace(/\/$/, '');
  const url = `${base}/games/${game.slug}`;
  const title = `${game.title} · AIsle 게임`;
  const description = game.description;
  const scoreOg = `${base}/og/games/${game.slug}?period=weekly`;
  const ogImage = [
    { url: scoreOg, alt: `${game.title} 주간 랭킹` },
    ...(game.thumbnail
      ? [{ url: new URL(game.thumbnail, `${base}/`).href, alt: game.title }]
      : []),
  ];
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: SEO_ROBOTS_PUBLIC,
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      images: ogImage,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ogImage.map((i) => i.url),
    },
  };
}

export default async function GameDetailPage({ params }: Props) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  const coverClass = game.thumbnail
    ? styles.coverImage
    : game.thumbVariant === 'brick'
      ? styles.coverBrick
      : styles.coverMini;

  return (
    <div className={styles.page}>
      <GameDetailRefresh />
      <header className={styles.top}>
        <Link className={styles.back} href="/games">
          ← 게임 허브
        </Link>
      </header>

      <main>
        <div className={`${styles.cover} ${coverClass}`} role="img" aria-label={`${game.title} 커버`}>
          {game.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.coverImg}
              src={game.thumbnail}
              alt=""
              width={132}
              height={64}
            />
          ) : null}
          <span className={styles.coverBadge}>공식 제공</span>
        </div>

        <div className={styles.detailBody}>
          <div className={styles.detailMain}>
            <h1>{game.title}</h1>
            <p className={styles.lede}>{game.description}</p>
            <p className={styles.rankMutedInline}>플레이는 로그인 후 이용할 수 있습니다.</p>
            <div className={styles.detailCtaRow}>
              <Link className={styles.ctaLg} href={`/games/${game.slug}/play`}>
                플레이 시작
              </Link>
              <GameShareButton slug={game.slug} title={game.title} />
            </div>
          </div>

          <GameRankingBoard gameSlug={game.slug} />
        </div>
      </main>

      <footer className={styles.foot}>
        <Link href="/games">← 게임 허브</Link>
        <span>/games/{game.slug}</span>
      </footer>
    </div>
  );
}
