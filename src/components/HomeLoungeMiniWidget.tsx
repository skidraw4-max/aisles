import Link from 'next/link';
import { fetchLatestForCategory } from '@/lib/home-composite';
import { homeHrefForCategory } from '@/lib/post-categories';
import styles from '@/app/page.module.css';

function formatShortDate(iso: Date) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

/** 메인 히어로·탭 아래 — LOUNGE 최신 5개 */
export async function HomeLoungeMiniWidget() {
  const posts = await fetchLatestForCategory('LOUNGE', 5);

  return (
    <aside className={styles.loungeMiniWidget} aria-labelledby="lounge-mini-heading">
      <div className={styles.loungeMiniHead}>
        <h2 id="lounge-mini-heading" className={styles.loungeMiniTitle}>
          LOUNGE 최신
        </h2>
        <Link href={homeHrefForCategory('LOUNGE')} className={styles.loungeMiniMore}>
          더보기 +
        </Link>
      </div>
      {posts.length === 0 ? (
        <p className={styles.loungeMiniEmpty}>아직 라운지 글이 없습니다.</p>
      ) : (
        <ul className={styles.loungeMiniList}>
          {posts.map((post) => {
            const cc = post._count?.comments ?? 0;
            return (
              <li key={post.id}>
                <Link href={`/post/${post.id}`} className={styles.loungeMiniRow}>
                  <span className={styles.loungeMiniRowTitle}>
                    <span className={styles.loungeMiniRowTitleText}>{post.title}</span>
                    <span className={styles.loungeMiniRowComments} title={`댓글 ${cc}개`}>
                      [{cc}]
                    </span>
                  </span>
                  <span className={styles.loungeMiniRowMeta}>{formatShortDate(post.createdAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
