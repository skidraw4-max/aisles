import Link from 'next/link';
import { PostThumbnail } from '@/components/post/PostThumbnail';
import type { Category } from '@prisma/client';
import homeStyles from '@/app/(root)/page.module.css';

export type FeedPostCardModel = {
  id: string;
  title: string;
  content?: string | null;
  thumbnail: string | null;
  category: Category;
  createdAt: string;
  likeCount: number;
  authorUsername: string;
  metadataParams?: unknown;
};

function formatCardDate(iso: string) {
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

/** 메인 홈 `ShowcaseCard`와 동일한 카드 마크업·스타일 */
export function FeedPostCard({ post, badgeLabel }: { post: FeedPostCardModel; badgeLabel: string }) {
  const snippetSource = post.content?.trim() ?? '';
  return (
    <div className={homeStyles.feedCardWrap}>
      <Link href={`/post/${post.id}`} className={homeStyles.feedCard}>
        <div className={homeStyles.feedCardMedia}>
          <PostThumbnail
            thumbnail={post.thumbnail}
            category={post.category}
            alt=""
            layout="card"
            metadataParams={post.metadataParams}
          />
          <span className={homeStyles.feedCardBadge}>{badgeLabel}</span>
        </div>
        <div className={homeStyles.feedCardBody}>
          <h3 className={homeStyles.feedCardTitle}>{post.title}</h3>
          {snippetSource ? (
            <p className={homeStyles.feedCardSnippet}>
              {snippetSource.length > 120 ? `${snippetSource.slice(0, 120)}…` : snippetSource}
            </p>
          ) : null}
          <p className={homeStyles.feedCardDate}>{formatCardDate(post.createdAt)}</p>
          <div className={homeStyles.cardFooter}>
            <span className={homeStyles.cardAuthor}>{post.authorUsername}</span>
            <span className={homeStyles.likeStamp} title="좋아요">
              <span className={homeStyles.heartIcon} aria-hidden>
                ♡
              </span>
              <span className={homeStyles.likeNum}>{post.likeCount}</span>
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}
