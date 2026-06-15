'use client';

import { usePostViewer } from './PostViewerContext';
import { PostOwnerActions } from './PostOwnerActions';

type Props = {
  postId: string;
  postTitle: string;
  authorId: string;
  afterDeleteHref: string;
};

/** ISR 셸 — 로그인·작성자 확인은 클라이언트에서 */
export function PostOwnerActionsGate({ postId, postTitle, authorId, afterDeleteHref }: Props) {
  const { userId, loaded } = usePostViewer();
  if (!loaded || userId !== authorId) return null;
  return (
    <PostOwnerActions postId={postId} postTitle={postTitle} afterDeleteHref={afterDeleteHref} />
  );
}
