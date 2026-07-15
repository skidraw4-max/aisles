'use client';

import { useCallback, useEffect, useState } from 'react';
import { tryCreateBrowserClient } from '@/lib/supabase/client';
import type { GameSlug } from '@/lib/games/catalog';
import {
  defaultMode,
  formatScore,
  modeLabel,
  modesForGame,
  type GameMode,
  type RankRow,
  type RankingPeriod,
} from '@/lib/games/ranking';
import styles from './games.module.css';

type Props = {
  gameSlug: GameSlug;
  compact?: boolean;
};

type ApiPayload = {
  entries: RankRow[];
  me: RankRow | null;
  weekKey: string;
};

export function GameRankingBoard({ gameSlug, compact = false }: Props) {
  const modes = modesForGame(gameSlug);
  const [period, setPeriod] = useState<RankingPeriod>('weekly');
  const [mode, setMode] = useState<GameMode>(defaultMode(gameSlug));
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: HeadersInit = {};
      const supabase = tryCreateBrowserClient();
      if (supabase) {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      }
      const qs = new URLSearchParams({
        period,
        mode,
        limit: compact ? '3' : '10',
      });
      const res = await fetch(`/api/games/${gameSlug}/scores?${qs}`, { headers });
      if (!res.ok) {
        throw new Error('랭킹을 불러오지 못했습니다.');
      }
      const json = (await res.json()) as ApiPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [compact, gameSlug, mode, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      className={compact ? styles.snippet : styles.rank}
      id={compact ? undefined : 'rank'}
      aria-label={`${gameSlug} 랭킹`}
    >
      <div className={styles.rankHead}>
        <h2>{compact ? '랭킹' : '주간 / 전체 랭킹'}</h2>
        <div className={styles.tabs} role="tablist" aria-label="기간">
          <button
            type="button"
            role="tab"
            aria-selected={period === 'weekly'}
            className={`${styles.tab} ${period === 'weekly' ? styles.tabOn : ''}`}
            onClick={() => setPeriod('weekly')}
          >
            주간
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period === 'overall'}
            className={`${styles.tab} ${period === 'overall' ? styles.tabOn : ''}`}
            onClick={() => setPeriod('overall')}
          >
            전체
          </button>
        </div>
      </div>

      {modes.length > 1 ? (
        <div className={`${styles.tabs} ${styles.modeTabs}`} role="tablist" aria-label="모드">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`${styles.tab} ${mode === m ? styles.tabOn : ''}`}
              onClick={() => setMode(m)}
            >
              {modeLabel(m)}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className={styles.rankMutedInline}>불러오는 중…</p>
      ) : error ? (
        <p className={styles.rankMutedInline}>{error}</p>
      ) : (
        <>
          <ol className={`${styles.rankList} ${compact ? styles.rankCompact : ''}`}>
            {(data?.entries ?? []).length === 0 ? (
              <li className={styles.rankMuted}>
                <span>—</span>
                <span>아직 기록이 없습니다</span>
                <span>—</span>
              </li>
            ) : (
              (data?.entries ?? []).map((row) => (
                <li key={`${row.userId}-${row.rank}`}>
                  <span>{row.rank}</span>
                  <span>{row.username}</span>
                  <span>{formatScore(row.score)}</span>
                </li>
              ))
            )}
            <li className={`${styles.rankMuted} ${styles.rankMine}`}>
              <span>MY</span>
              <span>{data?.me ? data.me.username : '로그인 후 기록 표시'}</span>
              <span>
                {data?.me
                  ? `${data.me.rank}위 · ${formatScore(data.me.score)}`
                  : '—'}
              </span>
            </li>
          </ol>
          {!compact ? (
            <p className={styles.hookNote}>
              점수는 API(<code>POST /api/games/{gameSlug}/scores</code>)로 제출됩니다. 게임
              iframe이 아직 연동되기 전이면 MY는 비어 있을 수 있습니다.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
