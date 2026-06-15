import { notFound } from 'next/navigation';
import type { Category } from '@prisma/client';
import { aiFortunePayloadFromDb } from '@/lib/ai-fortune/payload';
import { homeHrefForCategory } from '@/lib/post-categories';
import { AiFortuneReportWithViewer } from './AiFortuneReportWithViewer';
import { FortuneDigestSubscribeCtaWithViewer } from './FortuneDigestSubscribeCtaWithViewer';
import { PostEngagement } from './PostEngagement';
import { PostEngagementProviders } from './PostEngagementProviders';
import { PostViewerProvider } from './PostViewerContext';
import { PostAdjacentNav } from './PostAdjacentNav';
import { PostOwnerActionsGate } from './PostOwnerActionsGate';
import { ContentReportLink } from '@/components/ContentReportLink';
import { getCanonicalSiteUrl } from '@/lib/canonical-site-url';
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
  prevPost,
  nextPost,
  related,
  popular,
  uiLabels,
}: Props) {
  const payload = aiFortunePayloadFromDb(post.aiFortunePayload);
  if (!payload) notFound();

  const listHref = homeHrefForCategory(post.category);
  const postPageUrl = `${getCanonicalSiteUrl().replace(/\/$/, '')}/post/${post.id}`;

  const engagement = (
    <>
      <PostEngagement
        postId={post.id}
        initialComments={initialComments}
        currentUserId={null}
        currentUsername={null}
        currentAvatarUrl={null}
        listHref={listHref}
        adjacentNav={<PostAdjacentNav prev={prevPost} next={nextPost} />}
      />
      <ContentReportLink postUrl={postPageUrl} />
      <PostOwnerActionsGate
        postId={post.id}
        postTitle={post.title}
        authorId={post.author.id}
        afterDeleteHref={listHref}
      />
    </>
  );

  return (
    <PostViewerProvider postId={post.id}>
      <PostEngagementProviders postId={post.id} initialLikeCount={post.likeCount}>
        <main className={postStyles.magazineShell}>
          <div className={postStyles.magazineInner}>
            <div className={postStyles.magazineGrid}>
              <div className={postStyles.magazineMainCol}>
                <AiFortuneReportWithViewer
                  title={post.title}
                  weekLabel={weekLabel}
                  authorUsername={post.author.username}
                  createdAt={post.createdAt}
                  payload={payload}
                  engagement={engagement}
                />
                <FortuneDigestSubscribeCtaWithViewer postId={post.id} />
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
      </PostEngagementProviders>
    </PostViewerProvider>
  );
}
