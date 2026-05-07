'use client';

import { useRouter } from 'next/navigation';
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

type PostBookmarkContextValue = {
  bookmarked: boolean;
  bookmarkPending: boolean;
  bookmarkError: string | null;
  toggleBookmark: () => Promise<void>;
};

const PostBookmarkContext = createContext<PostBookmarkContextValue | null>(null);

async function getAccessToken(): Promise<string | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function PostBookmarkProvider({
  postId,
  initialBookmarked,
  children,
}: {
  postId: string;
  initialBookmarked: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [bookmarkPending, setBookmarkPending] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const stateRef = useRef({ bookmarked });
  stateRef.current = { bookmarked };

  useEffect(() => {
    setBookmarked(initialBookmarked);
    inFlightRef.current = false;
    setBookmarkPending(false);
    setBookmarkError(null);
  }, [postId, initialBookmarked]);

  const toggleBookmark = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(`/post/${postId}`)}`);
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBookmarkPending(true);
    setBookmarkError(null);

    const { bookmarked: prev } = stateRef.current;
    setBookmarked(!prev);

    try {
      const res = await fetch(`/api/posts/${postId}/bookmark`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as { bookmarked?: boolean; error?: string };
      if (!res.ok) {
        setBookmarked(prev);
        setBookmarkError(data.error || '북마크를 처리할 수 없습니다.');
        return;
      }
      if (typeof data.bookmarked === 'boolean') {
        setBookmarked(data.bookmarked);
      }
    } catch {
      setBookmarked(prev);
      setBookmarkError('북마크를 처리할 수 없습니다.');
    } finally {
      inFlightRef.current = false;
      setBookmarkPending(false);
    }
  }, [postId, router]);

  const value: PostBookmarkContextValue = {
    bookmarked,
    bookmarkPending,
    bookmarkError,
    toggleBookmark,
  };

  return <PostBookmarkContext.Provider value={value}>{children}</PostBookmarkContext.Provider>;
}

export function usePostBookmark(): PostBookmarkContextValue {
  const ctx = useContext(PostBookmarkContext);
  if (!ctx) {
    throw new Error('usePostBookmark는 PostBookmarkProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}
