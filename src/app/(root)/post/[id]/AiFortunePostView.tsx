import { notFound } from 'next/navigation';
import type { Category } from '@prisma/client';
import { aiFortunePayloadFromDb } from '@/lib/ai-fortune/payload';
import { homeHrefForCategory } from '@/lib/post-categories';
import { AiFortuneReport } from './AiFortuneReport';
import { FortuneDigestSubscribeCta } from './FortuneDigestSubscribeCta';
import { PostEngagement } from './PostEngagement';
import { PostLikeProvider } from './PostLikeContext';
import { PostBookmarkProvider } from './PostBookmarkContext';
import { PostAdjacentNav } from './PostAdjacentNav';
import { PostOwnerActions } from './PostOwnerActions';
import { PostSidebar, type SidebarPopularItem, type SidebarRelatedItem } from './PostSidebar';
import postStyles from './post.module.css';

type CommentRow = {
  id: string;
  content: string;
  createdAt: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl: string | null;
};

type Props = {
  post: {
    id: string;
    title: string;
    content: string | null;
    category: Category;
    createdAt: Date;
    likeCount: number;
    author: { id: string; username: string };
    aiFortunePayload: unknown;
  };
  weekLabel: string;
  initialComments: CommentRow[];
  currentUserId: string | null;
  currentUsername: string | null;
  currentAvatarUrl: string | null;
  initialLiked: boolean;
  initialBookmarked: boolean;
  newsletterSubscribed: boolean;
  prevPost: { id: string; title: string } | null;
  nextPost: { id: string; title: string } | null;
  related: SidebarRelatedItem[];
  popular: SidebarPopularItem[];
  uiLabels: Record<string, string>;
};

export function AiFortunePostView({
  post,
  weekLabel,
  initialComments,
  currentUserId,
  currentUsername,
  currentAvatarUrl,
  initialLiked,
  initialBookmarked,
  newsletterSubscribed,
  prevPost,
  nextPost,
  related,
  popular,
  uiLabels,
}: Props) {
  const payload = aiFortunePayloadFromDb(post.aiFortunePayload);
  if (!payload) notFound();

  const listHref = homeHrefForCategory(post.category);

  const engagement = (
    <PostLikeProvider postId={post.id} initialLikeCount={post.likeCount} initialLiked={initialLiked}>
      <PostBookmarkProvider postId={post.id} initialBookmarked={initialBookmarked}>
        <PostEngagement
          postId={post.id}
          initialComments={initialComments}
          currentUserId={currentUserId}
          currentUsername={currentUsername}
          currentAvatarUrl={currentAvatarUrl}
          listHref={listHref}
          adjacentNav={<PostAdjacentNav prev={prevPost} next={nextPost} />}
        />
        {currentUserId === post.author.id ? (
          <PostOwnerActions postId={post.id} postTitle={post.title} afterDeleteHref={listHref} />
        ) : null}
      </PostBookmarkProvider>
    </PostLikeProvider>
  );

  return (
    <main className={postStyles.magazineShell}>
      <div className={postStyles.magazineInner}>
        <div className={postStyles.magazineGrid}>
          <div className={postStyles.magazineMainCol}>
            <AiFortuneReport
              title={post.title}
              weekLabel={weekLabel}
              authorUsername={post.author.username}
              createdAt={post.createdAt}
              payload={payload}
              engagement={engagement}
            />
            <FortuneDigestSubscribeCta
              postId={post.id}
              isLoggedIn={Boolean(currentUserId)}
              newsletterSubscribed={newsletterSubscribed}
            />
          </div>
          <div className={postStyles.magazineSidebar}>
            <PostSidebar
              category={post.category}
              related={related}
              popular={popular}
              uiLabels={uiLabels}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
