'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';

type PostLikeContextValue = {
  likeCount: number;
  liked: boolean;
  likePending: boolean;
  likeError: string | null;
  toggleLike: () => Promise<void>;
};

const PostLikeContext = createContext<PostLikeContextValue | null>(null);

export function PostLikeProvider({
  postId,
  initialLikeCount,
  initialLiked,
  children,
}: {
  postId: string;
  initialLikeCount: number;
  initialLiked: boolean;
  children: ReactNode;
}) {
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [liked, setLiked] = useState(initialLiked);
  const [likePending, setLikePending] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const likeInFlightRef = useRef(false);
  const stateRef = useRef({ liked, likeCount });
  stateRef.current = { liked, likeCount };

  useEffect(() => {
    setLikeCount(initialLikeCount);
    setLiked(initialLiked);
    likeInFlightRef.current = false;
    setLikePending(false);
    setLikeError(null);
  }, [postId, initialLikeCount, initialLiked]);

  const toggleLike = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setLikeError('로그인 후 추천할 수 있습니다.');
      return;
    }

    if (likeInFlightRef.current) return;
    likeInFlightRef.current = true;
    setLikePending(true);
    setLikeError(null);

    const { liked: prevLiked, likeCount: prevCount } = stateRef.current;
    setLiked(!prevLiked);
    setLikeCount((c) => (prevLiked ? Math.max(0, c - 1) : c + 1));

    try {
      const res = await fetch(`/api/posts/${postId}/like`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { error?: string; liked?: boolean; likeCount?: number };
      if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
      if (typeof data.liked === 'boolean' && typeof data.likeCount === 'number') {
        setLiked(data.liked);
        setLikeCount(data.likeCount);
      }
    } catch (e) {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      setLikeError(e instanceof Error ? e.message : '추천 처리에 실패했습니다.');
    } finally {
      likeInFlightRef.current = false;
      setLikePending(false);
    }
  }, [postId]);

  const value: PostLikeContextValue = {
    likeCount,
    liked,
    likePending,
    likeError,
    toggleLike,
  };

  return <PostLikeContext.Provider value={value}>{children}</PostLikeContext.Provider>;
}

export function usePostLike(): PostLikeContextValue {
  const ctx = useContext(PostLikeContext);
  if (!ctx) {
    throw new Error('usePostLike는 PostLikeProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}
