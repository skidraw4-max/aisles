'use client';

import { useEffect, useRef } from 'react';
import type { GameSlug } from '@/lib/games/catalog';
import { isValidMode } from '@/lib/games/ranking';
import {
  isTrustedGameMessageOrigin,
  parseAisleGameScoreMessage,
} from '@/lib/games/score-bridge';
import { tryCreateBrowserClient } from '@/lib/supabase/client';
import styles from './games.module.css';

type Props = {
  gameSlug: GameSlug;
  embedPath: string;
  title: string;
};

async function resolveAccessToken(): Promise<string | null> {
  const supabase = tryCreateBrowserClient();
  if (!supabase) return null;

  const { data: first } = await supabase.auth.getSession();
  let token = first.session?.access_token ?? null;
  if (token) return token;

  const { data: refreshed } = await supabase.auth.refreshSession();
  token = refreshed.session?.access_token ?? null;
  return token;
}

/**
 * Same-origin game iframe + postMessage score bridge → POST /api/games/[slug]/scores.
 */
export function GamePlayShell({ gameSlug, embedPath, title }: Props) {
  const lastKeyRef = useRef<string>('');

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isTrustedGameMessageOrigin(event.origin, window.location.origin)) return;
      const parsed = parseAisleGameScoreMessage(event.data);
      if (!parsed) return;
      if (!isValidMode(gameSlug, parsed.mode)) return;

      const key = `${parsed.mode}:${parsed.score}`;
      if (lastKeyRef.current === key) return;
      lastKeyRef.current = key;

      void (async () => {
        try {
          const token = await resolveAccessToken();
          if (!token) {
            console.warn('[games] score skipped: no auth session');
            return;
          }

          const res = await fetch(`/api/games/${gameSlug}/scores`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ mode: parsed.mode, score: parsed.score }),
            keepalive: true,
          });
          if (!res.ok) {
            console.warn('[games] score POST failed', res.status);
          }
        } catch {
          // Soft-fail: local game PB still saved; ranking updates on next successful submit.
        }
      })();
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [gameSlug]);

  // Parent-page arrow scroll when focus is outside the iframe (ads, play bar).
  useEffect(() => {
    const scrollKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    const onKeyDown = (event: KeyboardEvent) => {
      if (!scrollKeys.has(event.key)) return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const focusFrame = () => {
      try {
        frame.focus({ preventScroll: true });
      } catch {
        frame.focus();
      }
    };
    focusFrame();
    frame.addEventListener('load', focusFrame);
    return () => frame.removeEventListener('load', focusFrame);
  }, [embedPath]);

  return (
    <iframe
      ref={iframeRef}
      className={styles.embedFrame}
      src={embedPath}
      title={title}
      allow="autoplay; fullscreen"
      loading="eager"
      referrerPolicy="no-referrer-when-downgrade"
      tabIndex={0}
    />
  );
}
