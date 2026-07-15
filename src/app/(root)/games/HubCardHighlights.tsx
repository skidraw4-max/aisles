import {
  formatScore,
  modeLabel,
  type GameMode,
} from '@/lib/games/ranking';
import type { HubHighlight } from '@/lib/games/ranking-store';
import styles from './games.module.css';

type Props = {
  highlights: HubHighlight[];
};

export function HubCardHighlights({ highlights }: Props) {
  if (highlights.length === 0) return null;

  return (
    <ul className={styles.hubHighlights} aria-label="이번 주 TOP">
      {highlights.map((h) => (
        <li key={h.mode}>
          <span className={styles.hubHighlightMode}>{modeLabel(h.mode as GameMode)}</span>
          {h.username && h.score != null ? (
            <span>
              1위 {h.username} · {formatScore(h.score)}
            </span>
          ) : (
            <span className={styles.rankMutedInline}>기록 없음</span>
          )}
        </li>
      ))}
    </ul>
  );
}
