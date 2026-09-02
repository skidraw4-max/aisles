import Link from 'next/link';
import { FeedPostLink } from '@/components/FeedPostLink';
import { fetchGalleryPostsWithCachedAnalysis } from '@/lib/gallery-reverse-hub.server';
import styles from './post.module.css';

/** LOUNGE 상세 — GALLERY 역분석 예시로 연결 */
export async function LoungeGalleryBridge() {
  const posts = await fetchGalleryPostsWithCachedAnalysis(4);
  if (posts.length === 0) {
    return (
      <aside className={styles.loungeGalleryBridge} aria-label="AI 이미지 갤러리">
        <h2 className={styles.loungeGalleryBridgeTitle}>AI 이미지 역분석</h2>
        <p className={styles.loungeGalleryBridgeMeta}>
          <Link href="/?category=GALLERY">갤러리 복도</Link>에서 AI 이미지와 역분석 예시를 모아
          볼 수 있습니다.
        </p>
      </aside>
    );
  }

  return (
    <aside className={styles.loungeGalleryBridge} aria-label="AI 이미지 역분석 예시">
      <h2 className={styles.loungeGalleryBridgeTitle}>AI 이미지 역분석 예시</h2>
      <p className={styles.loungeGalleryBridgeMeta}>
        뉴스와 함께, 갤러리에서 프롬프트·스타일 역분석 결과를 확인해 보세요.
      </p>
      <ul className={styles.loungeGalleryBridgeList}>
        {posts.map((p) => (
          <li key={p.id}>
            <FeedPostLink
              href={`/post/${p.id}`}
              className={styles.loungeGalleryBridgeLink}
              postId={p.id}
              category="GALLERY"
              surface="lounge_gallery_bridge"
            >
              {p.title}
            </FeedPostLink>
          </li>
        ))}
      </ul>
      <Link href="/?category=GALLERY" className={styles.loungeGalleryBridgeMore}>
        갤러리 전체 보기 →
      </Link>
    </aside>
  );
}
