import Link from 'next/link';
import { MediaThumb } from '@/components/MediaThumb';
import {
  homeHrefForCategory,
  POST_CATEGORY_OPTIONS,
} from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import type { HomeFeedPost } from '@/lib/home-feed';
import {
  fetchCommunityPreviewPosts,
  fetchLatestLabGalleryEight,
} from '@/lib/home-composite';
import styles from '@/app/page.module.css';

function categoryUiLabel(c: Category) {
  return POST_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function formatDate(iso: Date) {
  try {
    return new Date(iso).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function MoreLink({ category, label }: { category: Category; label: string }) {
  return (
    <Link href={homeHrefForCategory(category)} className={styles.compositeMoreLink}>
      {label} 더보기 <span aria-hidden>+</span>
    </Link>
  );
}

function ShowcaseCard({ post }: { post: HomeFeedPost }) {
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          {post.thumbnail ? (
            <MediaThumb url={post.thumbnail} alt="" objectFit="cover" />
          ) : (
            <div className={styles.feedCardPlaceholder} aria-hidden />
          )}
          <span className={styles.feedCardBadge}>{categoryUiLabel(post.category)}</span>
        </div>
        <div className={styles.feedCardBody}>
          <h3 className={styles.feedCardTitle}>{post.title}</h3>
          {post.content ? (
            <p className={styles.feedCardSnippet}>
              {post.content.length > 120 ? `${post.content.slice(0, 120)}…` : post.content}
            </p>
          ) : null}
          <p className={styles.feedCardDate}>{formatDate(post.createdAt)}</p>
          <div className={styles.cardFooter}>
            <span className={styles.cardAuthor}>{post.author.username}</span>
            <span className={styles.likeStamp} title="좋아요">
              <span className={styles.heartIcon} aria-hidden>
                ♡
              </span>
              <span className={styles.likeNum}>{post.likeCount}</span>
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

function AsideListItem({ post }: { post: HomeFeedPost }) {
  const cc = post._count?.comments ?? 0;
  return (
    <li className={styles.quasarAsideListItem}>
      <Link href={`/post/${post.id}`} className={styles.quasarAsideListLink}>
        <span className={styles.quasarAsideListTitle}>{post.title}</span>
        <span className={styles.quasarAsideListMeta}>
          {post.author.username}
          {cc > 0 ? ` · 댓글 ${cc}` : ''} · {formatDate(post.createdAt)}
        </span>
      </Link>
    </li>
  );
}

/** 퀘이사존식 메인: 좌측 LAB·GALLERY 최신 8칸(4×2), 우측 LOUNGE·GOSSIP 최신 리스트 */
export async function HomeQuasarBoard() {
  const [labGallery, community] = await Promise.all([
    fetchLatestLabGalleryEight(),
    fetchCommunityPreviewPosts(),
  ]);

  return (
    <div className={styles.quasarBoardOuter}>
      <div className={styles.quasarBoardGrid}>
        <div className={styles.quasarBoardMain}>
          <header className={styles.quasarBoardHead}>
            <div>
              <h2 className={styles.quasarBoardTitle}>AI Work</h2>
              <p className={styles.quasarBoardSubtitle}>Lab·Gallery 최신 글</p>
            </div>
            <div className={styles.compositeMoreGroup} role="group" aria-label="복도로 이동">
              <MoreLink category="RECIPE" label="LAB" />
              <MoreLink category="GALLERY" label="GALLERY" />
            </div>
          </header>
          {labGallery.length === 0 ? (
            <p className={styles.compositeEmpty}>아직 노출할 글이 없습니다.</p>
          ) : (
            <ul className={styles.aiWorkGrid}>
              {labGallery.map((post) => (
                <li key={post.id} className={styles.aiWorkGridCell}>
                  <ShowcaseCard post={post} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className={styles.quasarBoardAside} aria-label="라운지·가십 최신">
          <div className={styles.quasarAsidePanel}>
            <header className={styles.quasarAsidePanelHead}>
              <h2 className={styles.quasarAsidePanelTitle}>LOUNGE</h2>
              <MoreLink category="LOUNGE" label="LOUNGE" />
            </header>
            {community.lounge.length === 0 ? (
              <p className={styles.quasarAsideEmpty}>글이 없습니다.</p>
            ) : (
              <ul className={styles.quasarAsideList}>
                {community.lounge.map((post) => (
                  <AsideListItem key={post.id} post={post} />
                ))}
              </ul>
            )}
          </div>
          <div className={styles.quasarAsidePanel}>
            <header className={styles.quasarAsidePanelHead}>
              <h2 className={styles.quasarAsidePanelTitle}>GOSSIP</h2>
              <MoreLink category="GOSSIP" label="GOSSIP" />
            </header>
            {community.gossip.length === 0 ? (
              <p className={styles.quasarAsideEmpty}>글이 없습니다.</p>
            ) : (
              <ul className={styles.quasarAsideList}>
                {community.gossip.map((post) => (
                  <AsideListItem key={post.id} post={post} />
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
