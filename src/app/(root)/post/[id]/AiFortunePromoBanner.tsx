import Link from 'next/link';
import styles from './ai-fortune-promo-banner.module.css';

type Props = {
  ctaHref: string;
};

export function AiFortunePromoBanner({ ctaHref }: Props) {
  return (
    <aside className={styles.banner} aria-label="AI FORTUNE 안내">
      <div className={styles.inner}>
        <p className={styles.copy}>
          <strong>미래를 보는 AI 신전, 오픈! 🔮</strong> 이번 주 내 MBTI의 AI 운세와 커리어 꿀팁을
          확인해보세요.
        </p>
        <Link href={ctaHref} className={styles.cta}>
          AI 운세 · 커리어 보러가기
        </Link>
      </div>
    </aside>
  );
}

