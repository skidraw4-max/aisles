'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { getKakaoAdfitMainBannerUnitId, getKakaoAdfitUnitId } from '@/lib/kakao-adfit';
import styles from './AdBanner.module.css';

const KAKAO_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';
const ADFIT_POLL_INTERVAL_MS = 50;
/** 콜드 로드(캐시 없음)에서 ba.min.js + adfit 초기화까지 여유 */
const ADFIT_POLL_MAX_ATTEMPTS = 240;
const ADFIT_REFRESH_MAX_ATTEMPTS = 120;

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

type AdfitApi = {
  refresh?: (unit?: string) => void;
  destroy?: (unit: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

let scriptReady = false;
const scriptReadyListeners = new Set<() => void>();
let adfitPollTimer: ReturnType<typeof setTimeout> | null = null;
let adfitPollAttempts = 0;

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
  if (!isAdfitPresent()) return;
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

function stopAdfitPoll() {
  if (adfitPollTimer !== null) {
    clearTimeout(adfitPollTimer);
    adfitPollTimer = null;
  }
}

/** 여러 AdBanner 인스턴스가 동시에 호출해도 폴링은 1개만 — adfit 확인 후에만 ready 알림 */
function waitForAdfitThenNotify() {
  if (isAdfitPresent()) {
    stopAdfitPoll();
    adfitPollAttempts = 0;
    notifyScriptReady();
    return;
  }
  if (adfitPollTimer !== null) return;

  const tick = () => {
    adfitPollTimer = null;
    if (isAdfitPresent()) {
      adfitPollAttempts = 0;
      notifyScriptReady();
      return;
    }
    adfitPollAttempts += 1;
    const delay =
      adfitPollAttempts <= ADFIT_POLL_MAX_ATTEMPTS
        ? ADFIT_POLL_INTERVAL_MS
        : Math.min(500, ADFIT_POLL_INTERVAL_MS * 2);
    adfitPollTimer = setTimeout(tick, delay);
  };
  tick();
}

function scheduleAdfitRefresh(unit: string) {
  let attempts = 0;
  const tick = () => {
    const adfit = getAdfitWindow().adfit;
    if (adfit?.refresh) {
      try {
        adfit.refresh(unit);
      } catch {
        adfit.refresh();
      }
      return;
    }
    if (attempts++ < ADFIT_REFRESH_MAX_ATTEMPTS) {
      const delay =
        attempts <= ADFIT_POLL_MAX_ATTEMPTS
          ? ADFIT_POLL_INTERVAL_MS
          : Math.min(500, ADFIT_POLL_INTERVAL_MS * 2);
      setTimeout(tick, delay);
    }
  };
  requestAnimationFrame(tick);
}

let scriptInjectRequested = false;

function bindScriptLoadHandler(script: HTMLScriptElement) {
  if (script.dataset.adfitLoadBound === '1') return;
  script.dataset.adfitLoadBound = '1';
  script.addEventListener('load', () => waitForAdfitThenNotify(), { once: true });
  script.addEventListener('error', () => waitForAdfitThenNotify(), { once: true });
}

/**
 * Kakao 권장 순서: DOM에 ins가 먼저 존재한 뒤 ba.min.js 1회 로드.
 * 스크립트가 초기화될 때 .kakao_ad_area를 스캔하므로, ins를 나중에 붙이면 콜드 로드에서 누락될 수 있음.
 */
function ensureKakaoScriptLoaded() {
  if (isAdfitPresent()) {
    notifyScriptReady();
    return;
  }
  const existing = document.querySelector(`script[src="${KAKAO_SCRIPT_SRC}"]`) as HTMLScriptElement | null;
  if (existing) {
    bindScriptLoadHandler(existing);
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
  bindScriptLoadHandler(script);
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

function revealIns(ins: HTMLElement) {
  ins.style.display = 'block';
}

function destroyAdUnit(unit: string) {
  try {
    getAdfitWindow().adfit?.destroy?.(unit);
  } catch {
    /* AdFit destroy 미지원·이미 해제된 슬롯 */
  }
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
  const insRef = useRef<HTMLModElement>(null);
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

  useLayoutEffect(() => {
    if (!shouldLoadScript) return;
    const ins = insRef.current;
    if (!ins) return;

    invalidateScriptReadyIfStale();
    ensureKakaoScriptLoaded();

    const activate = () => {
      revealIns(ins);
      scheduleAdfitRefresh(kakaoUnit);
    };

    whenScriptReady(activate);

    return () => {
      destroyAdUnit(kakaoUnit);
      ins.style.display = 'none';
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

  const insSlot = (
    <ins
      ref={insRef}
      key={`${slotRemountKey}:${kakaoUnit}`}
      className="kakao_ad_area"
      style={{ display: 'none' }}
      data-ad-unit={kakaoUnit}
      data-ad-width={String(kakaoWidth)}
      data-ad-height={String(kakaoHeight)}
    />
  );

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
                <div className={styles.slot}>{insSlot}</div>
              </div>
              <span className={styles.badge}>광고</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.wrap}>
          <div className={styles.card} role="complementary" aria-label="광고">
            <div className={styles.slot}>{insSlot}</div>
          </div>
          <span className={styles.badge}>광고</span>
        </div>
      )}
    </>
  );
}
