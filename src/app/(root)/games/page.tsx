import type { Metadata } from 'next';
import Link from 'next/link';
import { GAME_LIST } from '@/lib/games/catalog';
import { modesForGame } from '@/lib/games/ranking';
import { fetchHubWeeklyHighlights } from '@/lib/games/ranking-store';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { HubCardHighlights } from './HubCardHighlights';
import styles from './games.module.css';

export const metadata: Metadata = {
  title: '게임 허브 · AIsle',
  description: 'AIsle 공식 미니게임 허브. URL 전용 접근.',
  robots: SEO_ROBOTS_PRIVATE,
};

export const dynamic = 'force-dynamic';

export default async function GamesHubPage() {
  const highlightMap = Object.fromEntries(
    await Promise.all(
      GAME_LIST.map(async (game) => {
        const highlights = await fetchHubWeeklyHighlights(game.slug, modesForGame(game.slug));
        return [game.slug, highlights] as const;
      })
    )
  );

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link className={styles.brand} href="/">
          AIsle
        </Link>
      </header>

      <main>
        <section className={styles.heroBlock}>
          <h1>게임 허브</h1>
          <p className={styles.lede}>
            공식 미니게임으로 잠깐 쉬어가세요. 현재는 앱 제공 게임만 제공하며 UGC는 없습니다.
            플레이는 로그인 후 이용할 수 있습니다.
          </p>
        </section>

        <section className={styles.cards} aria-label="게임 목록">
          {GAME_LIST.map((game) => (
            <article key={game.slug} className={styles.gameCard}>
              <div
                className={`${styles.thumb} ${
                  game.thumbnail
                    ? styles.thumbImage
                    : game.thumbVariant === 'brick'
                      ? styles.thumbBrick
                      : styles.thumbMini
                }`}
                aria-hidden="true"
              >
                {game.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.thumbImg}
                    src={game.thumbnail}
                    alt=""
                    width={526}
                    height={254}
                  />
                ) : (
                  <span className={styles.thumbLabel}>썸네일</span>
                )}
              </div>
              <h2>{game.title}</h2>
              <p>{game.shortDescription}</p>
              <HubCardHighlights highlights={highlightMap[game.slug] ?? []} />
              <Link className={styles.cta} href={`/games/${game.slug}`}>
                상세 보기
              </Link>
            </article>
          ))}
        </section>
      </main>

      <footer className={styles.foot}>
        <Link href="/">← AIsle 홈</Link>
        <span>/games</span>
      </footer>
    </div>
  );
}
