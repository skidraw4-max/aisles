import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GAME_LIST, getGame } from '@/lib/games/catalog';
import { SEO_ROBOTS_PRIVATE } from '@/lib/seo-robots';
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
    description: `${game.title} 플레이 (목업)`,
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
        <div className={styles.hud}>
          점수 <b>12,480</b> · 생명 ❤❤
        </div>
      </header>

      <main>
        <div className={styles.canvas} aria-label="게임 캔버스">
          <div className={styles.bricks} aria-hidden="true" />
          <div className={styles.ball} aria-hidden="true" />
          <div className={styles.paddle} aria-hidden="true" />
          <p className={styles.canvasHint}>게임 영역 (목업)</p>
        </div>

        <div className={styles.adSlot} role="note">
          <span className={styles.adTag}>Ad</span>
          <strong>중간 광고 슬롯 (인터스티셜)</strong>
          <p>플레이 중 전환 시 노출 예정 · 현재 플레이스홀더</p>
        </div>

        <button type="button" className={styles.rewarded} disabled>
          광고 보고 이어하기 / 보너스
        </button>
        <p className={styles.note}>
          보상형 · 중간 광고 자리 (플레이스홀더) · 메뉴 숨김 · URL로만 진입
        </p>
      </main>

      <footer className={styles.foot}>
        <Link href={`/games/${game.slug}`}>← 상세로</Link>
        <span>/games/{game.slug}/play</span>
      </footer>
    </div>
  );
}
