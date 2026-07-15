'use client';

import { useEffect, useRef } from 'react';
import type { GameSlug } from '@/lib/games/catalog';
import { isValidMode } from '@/lib/games/ranking';
import { parseAisleGameScoreMessage } from '@/lib/games/score-bridge';
import { tryCreateBrowserClient } from '@/lib/supabase/client';
import styles from './games.module.css';

type Props = {
  gameSlug: GameSlug;
  embedPath: string;
  title: string;
};

/**
 * Same-origin game iframe + postMessage score bridge → POST /api/games/[slug]/scores.
 */
export function GamePlayShell({ gameSlug, embedPath, title }: Props) {
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const parsed = parseAisleGameScoreMessage(event.data);
      if (!parsed) return;
      if (!isValidMode(gameSlug, parsed.mode)) return;

      const key = `${parsed.mode}:${parsed.score}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      void (async () => {
        try {
          const headers: HeadersInit = { 'Content-Type': 'application/json' };
          const supabase = tryCreateBrowserClient();
          if (supabase) {
            const { data: session } = await supabase.auth.getSession();
            const token = session.session?.access_token;
            if (token) headers.Authorization = `Bearer ${token}`;
          }
          if (!headers.Authorization) return;

          await fetch(`/api/games/${gameSlug}/scores`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ mode: parsed.mode, score: parsed.score }),
            keepalive: true,
          });
        } catch {
          // Soft-fail: local game PB still saved; ranking updates on next successful submit.
        }
      })();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [gameSlug]);

  return (
    <iframe
      className={styles.embedFrame}
      src={embedPath}
      title={title}
      allow="autoplay; fullscreen"
      loading="eager"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}
