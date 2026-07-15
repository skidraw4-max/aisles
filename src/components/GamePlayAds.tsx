'use client';

import { useState } from 'react';
import { KakaoAdSlot } from '@/components/KakaoAdSlot';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  getKakaoAdfitGameBannerUnitId,
  getKakaoAdfitGameStripUnitId,
  KAKAO_GAME_BANNER_HEIGHT,
  KAKAO_GAME_BANNER_WIDTH,
  KAKAO_GAME_STRIP_HEIGHT,
  KAKAO_GAME_STRIP_WIDTH,
} from '@/lib/kakao-adfit';
import styles from './GamePlayAds.module.css';

/**
 * 게임 플레이 셸용 AdFit (웹만).
 * - 하단 320×50 띠: iframe 아래(패들 비침범)
 * - 320×100: 셸 일시정지 오버레이(iframe pause 훅 없을 때 soft opportunity)
 */
export function GamePlayAds() {
  const [paused, setPaused] = useState(false);

  if (isCapacitorNative()) return null;

  const stripUnit = getKakaoAdfitGameStripUnitId();
  const bannerUnit = getKakaoAdfitGameBannerUnitId();

  return (
    <>
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

      <div className={styles.bannerPanel}>
        <button
          type="button"
          className={styles.pauseBtn}
          onClick={() => setPaused((v) => !v)}
          aria-expanded={paused}
        >
          {paused ? '이어하기' : '일시정지 · 광고 보기'}
        </button>
        {paused ? (
          <>
            <div className={styles.bannerSlot} role="complementary" aria-label="광고">
              <KakaoAdSlot
                key={`game-banner:${bannerUnit}`}
                unit={bannerUnit}
                width={KAKAO_GAME_BANNER_WIDTH}
                height={KAKAO_GAME_BANNER_HEIGHT}
              />
              <span className={styles.badge}>광고</span>
            </div>
            <p className={styles.hint}>게임 iframe 밖 셸 오버레이 · 스테이지 전환 시에도 동일 슬롯 활용</p>
          </>
        ) : null}
      </div>
    </>
  );
}
