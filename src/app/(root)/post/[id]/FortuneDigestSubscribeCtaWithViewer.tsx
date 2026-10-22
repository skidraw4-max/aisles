'use client';

import { FortuneDigestSubscribeCta } from './FortuneDigestSubscribeCta';
import { usePostViewer } from './PostViewerContext';

type Props = {
  postId: string;
};

export function FortuneDigestSubscribeCtaWithViewer({ postId }: Props) {
  const { isLoggedIn, newsletterSubscribed } = usePostViewer();
  return (
    <FortuneDigestSubscribeCta
      postId={postId}
      isLoggedIn={isLoggedIn}
      newsletterSubscribed={newsletterSubscribed}
    />
  );
}
