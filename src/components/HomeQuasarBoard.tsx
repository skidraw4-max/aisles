import Link from 'next/link';
import { Plus } from 'lucide-react';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import { HomeQuasarAsideListsLoader } from '@/components/HomeQuasarAsideListsLoader';
import {
  homeHrefForCategory,
  POST_CATEGORY_OPTIONS,
} from '@/lib/post-categories';
import type { Category } from '@prisma/client';
import { homeFeedCreatedAtToIso, type HomeFeedPost } from '@/lib/home-feed';
import {
  fetchCommunityPreviewPosts,
  fetchLatestLabGalleryEight,
} from '@/lib/home-composite';
import type { QuasarAsidePost } from '@/components/HomeQuasarAsideLists';
import styles from '@/app/(root)/page.module.css';

function serializeAsidePost(post: HomeFeedPost): QuasarAsidePost {
  return {
    id: post.id,
    title: post.title,
    authorUsername: post.author.username,
    commentCount: post._count?.comments ?? 0,
    createdAtIso: homeFeedCreatedAtToIso(post.createdAt as Date | string),
  };
}

async function loadQuasarPayload() {
  const [labGallery, community] = await Promise.all([
    fetchLatestLabGalleryEight(),
    fetchCommunityPreviewPosts(),
  ]);
  return { labGallery, community };
}

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

function ShowcaseCard({ post, imagePriority }: { post: HomeFeedPost; imagePriority?: boolean }) {
  return (
    <div className={styles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={styles.feedCard}>
        <div className={styles.feedCardMedia}>
          <PostThumbnail
            thumbnail={post.thumbnail}
            category={post.category}
            alt=""
            layout="card"
            metadataParams={post.metadata?.params}
            priority={imagePriority}
            sizes="(max-width: 479px) 100vw, (max-width: 959px) 50vw, 25vw"
          />
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

/** 퀘이사존식 메인: 좌측 LAB·GALLERY 최신 8칸(4×2), 우측 LOUNGE·GOSSIP 최신 리스트 */
export async function HomeQuasarBoard() {
  const { labGallery, community } = await loadQuasarPayload();

  return (
    <div className={styles.quasarBoardOuter}>
      <div className={styles.quasarBoardGrid}>
        <div className={styles.quasarBoardMain}>
          <header className={styles.quasarBoardHead}>
            <div>
              <h2 className={styles.quasarBoardTitle}>AI Work</h2>
              <p className={styles.quasarBoardSubtitle}>Lab·Gallery 최신 글</p>
            </div>
            <div className={styles.compositeMoreGroup} role="group" aria-label="AI Work 이동·등록">
              <Link
                href="/upload"
                className={styles.aiWorkPromptRegister}
                aria-label="나만의 프롬프트 등록"
              >
                <Plus className={styles.aiWorkPromptRegisterIcon} size={18} strokeWidth={2.25} aria-hidden />
                <span className={styles.aiWorkPromptRegisterText}>나만의 프롬프트 등록</span>
              </Link>
              <MoreLink category="RECIPE" label="LAB" />
              <MoreLink category="GALLERY" label="GALLERY" />
            </div>
          </header>
          {labGallery.length === 0 ? (
            <p className={styles.compositeEmpty}>아직 노출할 글이 없습니다.</p>
          ) : (
            <ul className={styles.aiWorkGrid}>
              {labGallery.map((post, i) => (
                <li key={post.id} className={styles.aiWorkGridCell}>
                  <ShowcaseCard post={post} imagePriority={i < 4} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <HomeQuasarAsideListsLoader
          lounge={community.lounge.map(serializeAsidePost)}
          gossip={community.gossip.map(serializeAsidePost)}
        />
      </div>
    </div>
  );
}
