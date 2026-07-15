import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GAME_LIST, getGame } from '@/lib/games/catalog';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { GameRankingBoard } from '../GameRankingBoard';
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
  return {
    title: `${game.title} · AIsle 게임`,
    description: game.shortDescription,
    robots: SEO_ROBOTS_PRIVATE,
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
      <header className={styles.top}>
        <Link className={styles.back} href="/games">
          ← 게임 허브
        </Link>
        <span className={styles.pill}>메뉴 미노출 · URL 전용</span>
      </header>

      <main>
        <div className={`${styles.cover} ${coverClass}`} role="img" aria-label={`${game.title} 커버`}>
          {game.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={styles.coverImg}
              src={game.thumbnail}
              alt=""
              width={526}
              height={254}
            />
          ) : null}
          <span className={styles.coverBadge}>공식 제공</span>
        </div>

        <div className={styles.detailBody}>
          <div className={styles.detailMain}>
            <h1>{game.title}</h1>
            <p className={styles.lede}>{game.description}</p>
            <p className={styles.rankMutedInline}>플레이는 로그인 후 이용할 수 있습니다.</p>
            <Link className={styles.ctaLg} href={`/games/${game.slug}/play`}>
              플레이 시작
            </Link>
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
