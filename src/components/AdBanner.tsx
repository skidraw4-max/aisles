'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { getKakaoAdfitMainBannerUnitId, getKakaoAdfitUnitId } from '@/lib/kakao-adfit';
import styles from './AdBanner.module.css';

const KAKAO_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 40;

export type AdBannerVariant = 'kakao-infeed' | 'kakao-leaderboard' | 'adsense';

type KakaoVariant = 'kakao-infeed' | 'kakao-leaderboard';

type Props = {
  variant?: AdBannerVariant;
  adUnit?: string;
  width?: number;
  height?: number;
  /** 홈 복도 탭 등 pathname은 같고 searchParams만 바뀔 때 슬롯 재마운트용 */
  remountKey?: string;
};

type AdfitWindow = Window & { adfit?: { refresh?: () => void } };

let scriptReady = false;
const scriptReadyListeners = new Set<() => void>();

function getAdfitWindow(): AdfitWindow {
  return window as AdfitWindow;
}

function isAdfitPresent(): boolean {
  return Boolean(getAdfitWindow().adfit);
}

/** 홈 이탈 등으로 script/adfit이 사라졌는데 scriptReady만 true인 stale 상태 복구 */
function invalidateScriptReadyIfStale() {
  if (scriptReady && !isAdfitPresent()) {
    scriptReady = false;
  }
}

function notifyScriptReady() {
  if (scriptReady) return;
  scriptReady = true;
  for (const listener of scriptReadyListeners) listener();
  scriptReadyListeners.clear();
}

function whenScriptReady(listener: () => void) {
  invalidateScriptReadyIfStale();
  if (scriptReady && isAdfitPresent()) listener();
  else scriptReadyListeners.add(listener);
}

/** ba.min.js onLoad 직후엔 window.adfit이 아직 없을 수 있어 폴링 후 ready 알림 */
function waitForAdfitThenNotify() {
  let attempts = 0;
  const tick = () => {
    if (isAdfitPresent()) {
      notifyScriptReady();
      return;
    }
    if (attempts++ < ADFIT_POLL_MAX_ATTEMPTS) {
      setTimeout(tick, ADFIT_POLL_INTERVAL_MS);
      return;
    }
    notifyScriptReady();
  };
  tick();
}

function scheduleAdfitRefresh() {
  let attempts = 0;
  const tick = () => {
    const refresh = getAdfitWindow().adfit?.refresh;
    if (refresh) {
      refresh();
      return;
    }
    if (attempts++ < ADFIT_POLL_MAX_ATTEMPTS) {
      setTimeout(tick, ADFIT_POLL_INTERVAL_MS);
    }
  };
  requestAnimationFrame(tick);
}

let scriptInjectRequested = false;

/** Next.js `<Script>`는 AdBanner 언마운트 시 태그가 사라져 adfit이 끊길 수 있어 DOM에 1회만 주입 */
function ensureKakaoScriptLoaded() {
  if (isAdfitPresent()) {
    notifyScriptReady();
    return;
  }
  const existing = document.querySelector(`script[src="${KAKAO_SCRIPT_SRC}"]`);
  if (existing) {
    waitForAdfitThenNotify();
    return;
  }
  if (scriptInjectRequested) {
    waitForAdfitThenNotify();
    return;
  }
  scriptInjectRequested = true;
  const script = document.createElement('script');
  script.src = KAKAO_SCRIPT_SRC;
  script.async = true;
  script.onload = () => waitForAdfitThenNotify();
  document.head.appendChild(script);
}

function isKakaoVariant(variant: AdBannerVariant): variant is KakaoVariant {
  return variant === 'kakao-infeed' || variant === 'kakao-leaderboard';
}

function resolveKakaoSize(
  variant: KakaoVariant,
  adUnit: string | undefined,
  width: number | undefined,
  height: number | undefined
): { unit: string; w: number; h: number } {
  if (variant === 'kakao-leaderboard') {
    return {
      unit: getKakaoAdfitMainBannerUnitId(adUnit),
      w: width ?? 728,
      h: height ?? 90,
    };
  }
  return {
    unit: getKakaoAdfitUnitId(adUnit),
    w: width ?? 300,
    h: height ?? 250,
  };
}

function mountKakaoIns(container: HTMLElement, unit: string, width: number, height: number) {
  container.innerHTML = '';
  const ins = document.createElement('ins');
  ins.className = 'kakao_ad_area';
  ins.style.display = 'none';
  ins.setAttribute('data-ad-unit', unit);
  ins.setAttribute('data-ad-width', String(width));
  ins.setAttribute('data-ad-height', String(height));
  container.appendChild(ins);

  requestAnimationFrame(() => {
    ins.style.display = 'block';
    scheduleAdfitRefresh();
  });
}

/**
 * 웹 전용 배너 — Kakao AdFit(인피드·리더보드) 또는 추후 AdSense 교체용.
 * Capacitor 네이티브에서는 렌더하지 않음 (NativeAdSlot 사용).
 */
export function AdBanner({
  variant = 'kakao-infeed',
  adUnit,
  width,
  height,
  remountKey,
}: Props) {
  const pathname = usePathname();
  const slotRemountKey = remountKey ?? pathname;
  const slotRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const isNative = isCapacitorNative();
  const isLeaderboard = variant === 'kakao-leaderboard';
  const shouldLoadScript = !isNative && isKakaoVariant(variant);
  const resolvedKakao = isKakaoVariant(variant)
    ? resolveKakaoSize(variant, adUnit, width, height)
    : null;
  const kakaoUnit = resolvedKakao?.unit ?? '';
  const kakaoWidth = resolvedKakao?.w ?? 0;
  const kakaoHeight = resolvedKakao?.h ?? 0;

  useEffect(() => {
    if (!shouldLoadScript) return;
    invalidateScriptReadyIfStale();
    if (scriptReady && isAdfitPresent()) return;
    ensureKakaoScriptLoaded();
  }, [shouldLoadScript]);

  useEffect(() => {
    if (!shouldLoadScript) return;
    const container = slotRef.current;
    if (!container) return;

    const mount = () => mountKakaoIns(container, kakaoUnit, kakaoWidth, kakaoHeight);

    whenScriptReady(mount);

    return () => {
      container.innerHTML = '';
    };
  }, [shouldLoadScript, kakaoUnit, kakaoWidth, kakaoHeight, slotRemountKey]);

  useEffect(() => {
    if (isNative || !isLeaderboard) return;
    const scaler = scalerRef.current;
    if (!scaler) return;

    const updateScale = () => {
      const parent = scaler.parentElement;
      if (!parent) return;
      const available = parent.clientWidth;
      setScale(available < kakaoWidth ? available / kakaoWidth : 1);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(scaler.parentElement ?? scaler);
    return () => observer.disconnect();
  }, [isNative, isLeaderboard, kakaoWidth]);

  if (isNative) return null;

  if (variant === 'adsense') {
    return null;
  }

  const slot = <div className={styles.slot} ref={slotRef} />;

  return (
    <>
      {isLeaderboard ? (
        <div className={styles.leaderboardWrap}>
          <div
            className={styles.leaderboardOuter}
            style={{ height: `${Math.round(kakaoHeight * scale)}px` }}
          >
            <div
              className={styles.leaderboardScaler}
              ref={scalerRef}
              style={{
                width: `${kakaoWidth}px`,
                height: `${kakaoHeight}px`,
                transform: scale < 1 ? `scale(${scale})` : undefined,
              }}
            >
              <div className={styles.leaderboardCard} role="complementary" aria-label="광고">
                {slot}
              </div>
              <span className={styles.badge}>광고</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.wrap}>
          <div className={styles.card} role="complementary" aria-label="광고">
            {slot}
          </div>
          <span className={styles.badge}>광고</span>
        </div>
      )}
    </>
  );
}
