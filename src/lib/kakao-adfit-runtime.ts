/** Kakao AdFit ba.min.js — 전역 1회 로드·ready 대기·슬롯 refresh 공용 런타임 */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 120;
const REFRESH_MAX_ATTEMPTS = 5;
const REFRESH_BASE_DELAY_MS = 400;

export type AdfitApi = {
  display?: (unit: string) => void;
  refresh?: (unit?: string) => void;
  destroy?: (unit: string) => void;
  render?: (unit?: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

function getAdfitWindow(): AdfitWindow {
  return window as AdfitWindow;
}

export function isAdfitPresent(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getAdfitWindow().adfit);
}

let readyResolved = false;
let readyPromise: Promise<void> | null = null;
const readyListeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollAttempts = 0;

function resolveReady() {
  if (!isAdfitPresent()) return;
  if (readyResolved) return;
  readyResolved = true;
  scanAllAdfitSlots();
  for (const listener of readyListeners) listener();
  readyListeners.clear();
}

function stopPoll() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/** script onLoad 이후 또는 adfit이 이미 있을 때 window.adfit 폴링 */
export function startAdfitPoll() {
  if (isAdfitPresent()) {
    stopPoll();
    pollAttempts = 0;
    resolveReady();
    return;
  }
  if (pollTimer !== null) return;

  const tick = () => {
    pollTimer = null;
    if (isAdfitPresent()) {
      pollAttempts = 0;
      resolveReady();
      return;
    }
    pollAttempts += 1;
    if (pollAttempts > ADFIT_POLL_MAX_ATTEMPTS) return;
    const delay =
      pollAttempts <= 40 ? ADFIT_POLL_INTERVAL_MS : Math.min(500, ADFIT_POLL_INTERVAL_MS * 2);
    pollTimer = setTimeout(tick, delay);
  };
  tick();
}

/** body 하단 Script onLoad·이미 캐시된 ba.min.js 모두 처리 */
export function onAdfitScriptLoad() {
  startAdfitPoll();
}

/** 클라이언트 hydration 직후 — 이미 로드된 ba.min.js ready 폴링 시작 */
export function bootstrapAdfitOnClient() {
  if (typeof window === 'undefined') return;
  startAdfitPoll();
}

/** adfit 소실(풀 리로드 등) 시 stale ready 복구 */
export function invalidateAdfitReadyIfStale() {
  if (readyResolved && !isAdfitPresent()) {
    readyResolved = false;
    readyPromise = null;
  }
}

/** 전역 adfit ready — 모든 AdBanner가 구독 */
export function whenAdfitReady(listener: () => void): void {
  invalidateAdfitReadyIfStale();
  if (readyResolved && isAdfitPresent()) {
    listener();
    return;
  }
  readyListeners.add(listener);
  startAdfitPoll();
}

export function getAdfitReadyPromise(): Promise<void> {
  invalidateAdfitReadyIfStale();
  if (readyResolved && isAdfitPresent()) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      whenAdfitReady(resolve);
    });
  }
  return readyPromise;
}

export function destroyAdUnit(unit: string) {
  try {
    getAdfitWindow().adfit?.destroy?.(unit);
  } catch {
    /* destroy 미지원·이미 해제된 슬롯 */
  }
}

/** script onLoad 이후 DOM 내 모든 ins.kakao_ad_area 스캔 */
export function scanAllAdfitSlots() {
  if (typeof document === 'undefined') return;
  const adfit = getAdfitWindow().adfit;
  if (!adfit) return;
  try {
    if (adfit.refresh) {
      adfit.refresh();
      return;
    }
  } catch {
    /* unit 없이 refresh 미지원 */
  }
  for (const ins of document.querySelectorAll<HTMLElement>('ins.kakao_ad_area')) {
    const unit = ins.getAttribute('data-ad-unit')?.trim();
    if (unit) invokeAdfitForUnit(adfit, unit);
  }
}

function invokeAdfitForUnit(adfit: AdfitApi, unit: string) {
  if (adfit.display) {
    adfit.display(unit);
    return true;
  }
  if (adfit.render) {
    adfit.render(unit);
    return true;
  }
  if (adfit.refresh) {
    try {
      adfit.refresh(unit);
    } catch {
      adfit.refresh();
    }
    return true;
  }
  return false;
}

/**
 * ins 노출 후 unit refresh — 3~5회 백오프(~2.4s).
 * cleanup 함수로 unmount 시 재시도 중단.
 */
export function refreshAdUnitWithBackoff(unit: string): () => void {
  let cancelled = false;
  let attempt = 0;

  const tick = () => {
    if (cancelled) return;
    const adfit = getAdfitWindow().adfit;
    if (adfit && invokeAdfitForUnit(adfit, unit)) {
      attempt += 1;
      if (attempt < REFRESH_MAX_ATTEMPTS) {
        setTimeout(tick, REFRESH_BASE_DELAY_MS * attempt);
      }
      return;
    }
    attempt += 1;
    if (attempt <= REFRESH_MAX_ATTEMPTS) {
      setTimeout(tick, REFRESH_BASE_DELAY_MS * attempt);
    }
  };

  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}
