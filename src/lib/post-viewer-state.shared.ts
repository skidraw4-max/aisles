/** `/api/posts/[id]/viewer-state` 응답 — 클라이언트·API 공유 */
export type PostViewerState = {
  userId: string | null;
  liked: boolean;
  bookmarked: boolean;
  username: string | null;
  avatarUrl: string | null;
  newsletterSubscribed: boolean;
  mbti: string | null;
};

export const EMPTY_POST_VIEWER_STATE: PostViewerState = {
  userId: null,
  liked: false,
  bookmarked: false,
  username: null,
  avatarUrl: null,
  newsletterSubscribed: false,
  mbti: null,
};
