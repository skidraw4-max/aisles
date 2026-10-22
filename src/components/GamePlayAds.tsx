'use client';

import { KakaoAdSlot } from '@/components/KakaoAdSlot';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  getKakaoAdfitGameStripUnitId,
  KAKAO_GAME_STRIP_HEIGHT,
  KAKAO_GAME_STRIP_WIDTH,
} from '@/lib/kakao-adfit';
import styles from './GamePlayAds.module.css';

/**
 * 게임 플레이 셸용 AdFit (웹만).
 * - 하단 320×50 띠: iframe 아래(패들 비침범)
 * - 320×100 오버레이 트리거 UI는 노출하지 않음(단위 ID는 kakao-adfit에 유지)
 */
export function GamePlayAds() {
  if (isCapacitorNative()) return null;

  const stripUnit = getKakaoAdfitGameStripUnitId();

  return (
    <div className={styles.strip} role="complementary" aria-label="광고">
      <div className={styles.stripSlot}>
        <KakaoAdSlot
          key={`game-strip:${stripUnit}`}
          unit={stripUnit}
          width={KAKAO_GAME_STRIP_WIDTH}
          height={KAKAO_GAME_STRIP_HEIGHT}
        />
        <span className={styles.badge}>광고</span>
      </div>
    </div>
  );
}
