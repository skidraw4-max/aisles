import Link from 'next/link';
import type { HomeFeedPost } from '@/lib/home-feed';
import { serializeFeedPost } from '@/lib/home-feed';
import styles from './ugc-weekly-best.module.css';

type Props = {
  categoryLabel: string;
  posts: HomeFeedPost[];
};

/** BUILD/LAUNCH 복도 — 최근 7일 좋아요 상위 */
export function UgcWeeklyBest({ categoryLabel, posts }: Props) {
  if (posts.length === 0) return null;

  return (
    <section className={styles.wrap} aria-labelledby="ugc-weekly-best-heading">
      <h2 id="ugc-weekly-best-heading" className={styles.heading}>
        {categoryLabel} · 이번 주 베스트
      </h2>
      <ol className={styles.list}>
        {posts.map((raw, i) => {
          const post = serializeFeedPost(raw);
          return (
            <li key={post.id}>
              <Link href={`/post/${post.id}`} className={styles.link}>
                <span className={styles.rank}>{i + 1}</span>
                <span className={styles.title}>{post.title}</span>
                <span className={styles.likes}>♥ {post.likeCount}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
