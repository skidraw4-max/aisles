import Link from 'next/link';
import styles from './post.module.css';

export type AdjacentPostBrief = {
  id: string;
  title: string;
} | null;

type Props = {
  prev: AdjacentPostBrief;
  next: AdjacentPostBrief;
};

export function PostAdjacentNav({ prev, next }: Props) {
  if (!prev && !next) return null;

  const pair = Boolean(prev) && Boolean(next);

  return (
    <nav
      className={`${styles.adjacentNav} ${pair ? '' : styles.adjacentNavSingle}`}
      aria-label="이전·다음 글"
    >
      {prev ? (
        <Link href={`/post/${prev.id}`} className={styles.adjacentCard}>
          <span className={styles.adjacentLabel}>이전 글</span>
          <span className={styles.adjacentTitle}>{prev.title}</span>
        </Link>
      ) : null}
      {next ? (
        <Link
          href={`/post/${next.id}`}
          className={`${styles.adjacentCard} ${pair ? styles.adjacentCardNext : styles.adjacentCardSoloNext}`}
        >
          <span className={styles.adjacentLabel}>다음 글</span>
          <span className={styles.adjacentTitle}>{next.title}</span>
        </Link>
      ) : null}
    </nav>
  );
}
