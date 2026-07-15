import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GamePlayAds } from '@/components/GamePlayAds';
import { GAME_LIST, getGame } from '@/lib/games/catalog';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
import { GamePlayShell } from '../../GamePlayShell';
import styles from '../../games.module.css';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return GAME_LIST.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) {
    return { title: '플레이 · AIsle', robots: SEO_ROBOTS_PRIVATE };
  }
  return {
    title: `플레이 · ${game.title} · AIsle`,
    description: `${game.title} 플레이`,
    robots: SEO_ROBOTS_PRIVATE,
  };
}

export default async function GamePlayPage({ params }: Props) {
  const { slug } = await params;
  const game = getGame(slug);
  if (!game) notFound();

  return (
    <div className={styles.playPage}>
      <header className={styles.playBar}>
        <Link className={styles.back} href={`/games/${game.slug}`}>
          ← 나가기
        </Link>
        <strong>{game.title}</strong>
        <div className={styles.hud}>PC · 마우스/키보드 · 모바일 · 터치</div>
      </header>

      <main>
        <div className={styles.embedWrap}>
          <GamePlayShell
            gameSlug={game.slug}
            embedPath={game.embedPath}
            title={`${game.title} 플레이`}
          />
        </div>

        <GamePlayAds />
      </main>

      <footer className={styles.foot}>
        <Link href={`/games/${game.slug}`}>← 상세로</Link>
        <span>/games/{game.slug}/play</span>
      </footer>
    </div>
  );
}
