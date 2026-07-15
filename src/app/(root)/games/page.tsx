import type { Metadata } from 'next';
import Link from 'next/link';
import { GAME_LIST } from '@/lib/games/catalog';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { RankingStub } from './RankingStub';
import styles from './games.module.css';

export const metadata: Metadata = {
  title: '게임 허브 · AIsle',
  description: 'AIsle 공식 미니게임 허브 (목업). URL 전용 접근.',
  robots: SEO_ROBOTS_PRIVATE,
};

export default function GamesHubPage() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link className={styles.brand} href="/">
          AIsle
        </Link>
        <span className={styles.pill}>메뉴에 없음 · URL 전용 접근</span>
      </header>

      <main>
        <section className={styles.heroBlock}>
          <h1>게임 허브</h1>
          <p className={styles.lede}>
            공식 미니게임으로 잠깐 쉬어가세요. 현재는 앱 제공 게임만 제공하며 UGC는 없습니다.
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
              <Link className={styles.cta} href={`/games/${game.slug}`}>
                플레이
              </Link>
            </article>
          ))}
        </section>

        <RankingStub />
      </main>

      <footer className={styles.foot}>
        <Link href="/">← AIsle 홈</Link>
        <span>/games</span>
      </footer>
    </div>
  );
}
