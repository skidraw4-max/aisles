'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  EMPTY_POST_VIEWER_STATE,
  type PostViewerState,
} from '@/lib/post-viewer-state.shared';
import { parseMbtiType, type MbtiType } from '@/lib/ai-fortune/mbti';

type PostViewerContextValue = PostViewerState & {
  loaded: boolean;
  userMbti: MbtiType | null;
  isLoggedIn: boolean;
  refresh: () => Promise<void>;
};

const PostViewerContext = createContext<PostViewerContextValue | null>(null);

export function PostViewerProvider({ postId, children }: { postId: string; children: ReactNode }) {
  const [state, setState] = useState<PostViewerState>(EMPTY_POST_VIEWER_STATE);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setState(EMPTY_POST_VIEWER_STATE);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`/api/posts/${postId}/viewer-state`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        setState(EMPTY_POST_VIEWER_STATE);
        return;
      }
      const data = (await res.json()) as PostViewerState;
      setState(data);
    } catch {
      setState(EMPTY_POST_VIEWER_STATE);
    } finally {
      setLoaded(true);
    }
  }, [postId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  const value = useMemo<PostViewerContextValue>(
    () => ({
      ...state,
      loaded,
      userMbti: parseMbtiType(state.mbti),
      isLoggedIn: Boolean(state.userId),
      refresh,
    }),
    [state, loaded, refresh]
  );

  return <PostViewerContext.Provider value={value}>{children}</PostViewerContext.Provider>;
}

export function usePostViewer(): PostViewerContextValue {
  const ctx = useContext(PostViewerContext);
  if (!ctx) {
    throw new Error('usePostViewer must be used within PostViewerProvider');
  }
  return ctx;
}

/** Provider 없이도 안전하게 읽기(선택적) */
export function usePostViewerOptional(): PostViewerContextValue | null {
  return useContext(PostViewerContext);
}
