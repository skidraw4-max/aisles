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
import { AuthModal } from '@/components/AuthModal';
import { createClient } from '@/lib/supabase/client';
import {
  addGuestBookmark,
  clearGuestBookmarks,
  getGuestBookmarkIds,
  isGuestBookmarked,
  removeGuestBookmark,
} from '@/lib/guest-bookmarks';
import { sendGAEvent } from '@/lib/ga4';
import { GuestBookmarkSnackbar } from './GuestBookmarkSnackbar';

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
  const [guestSnackbarOpen, setGuestSnackbarOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const inFlightRef = useRef(false);
  const mergeStartedRef = useRef(false);
  const stateRef = useRef({ bookmarked });
  stateRef.current = { bookmarked };

  useEffect(() => {
    setBookmarked(initialBookmarked || isGuestBookmarked(postId));
    inFlightRef.current = false;
    setBookmarkPending(false);
    setBookmarkError(null);
  }, [postId, initialBookmarked]);

  useEffect(() => {
    if (!guestSnackbarOpen) return;
    const t = window.setTimeout(() => setGuestSnackbarOpen(false), 3000);
    return () => window.clearTimeout(t);
  }, [guestSnackbarOpen]);

  const mergeGuestBookmarks = useCallback(async (token: string) => {
    if (mergeStartedRef.current) return;
    mergeStartedRef.current = true;
    const ids = getGuestBookmarkIds();
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/posts/${id}/bookmark`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null)
      )
    );
    clearGuestBookmarks();
    router.refresh();
  }, [router]);

  useEffect(() => {
    void (async () => {
      const token = await getAccessToken();
      if (token) await mergeGuestBookmarks(token);
    })();
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const token = session?.access_token;
      if (token) void mergeGuestBookmarks(token);
    });
    return () => subscription.unsubscribe();
  }, [mergeGuestBookmarks]);

  const toggleBookmark = useCallback(async () => {
    const token = await getAccessToken();

    if (!token) {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setBookmarkPending(true);
      setBookmarkError(null);

      const { bookmarked: prev } = stateRef.current;
      const next = !prev;
      setBookmarked(next);

      try {
        if (next) {
          addGuestBookmark(postId);
          sendGAEvent('guest_bookmark_save', { post_id: postId });
          setGuestSnackbarOpen(true);
        } else {
          removeGuestBookmark(postId);
        }
      } catch {
        setBookmarked(prev);
        setBookmarkError('북마크를 저장할 수 없습니다.');
      } finally {
        inFlightRef.current = false;
        setBookmarkPending(false);
      }
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
  }, [postId]);

  const value: PostBookmarkContextValue = {
    bookmarked,
    bookmarkPending,
    bookmarkError,
    toggleBookmark,
  };

  return (
    <PostBookmarkContext.Provider value={value}>
      {children}
      <GuestBookmarkSnackbar
        open={guestSnackbarOpen}
        postId={postId}
        onLogin={() => setAuthOpen(true)}
      />
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={() => {
          setAuthOpen(false);
          router.refresh();
        }}
      />
    </PostBookmarkContext.Provider>
  );
}

export function usePostBookmark(): PostBookmarkContextValue {
  const ctx = useContext(PostBookmarkContext);
  if (!ctx) {
    throw new Error('usePostBookmark는 PostBookmarkProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}
