/** Kakao AdFit ba.min.js — layout body 하단에서 정적 1회 로드 */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 120;
const RENDER_MAX_ATTEMPTS = 5;
const RENDER_BASE_DELAY_MS = 400;

export type AdfitApi = {
  destroy?: (unit: string) => void;
  render?: (unit?: string) => void;
  /** 구 SDK·문서 예시 — 프로덕션 ba.min.js에는 없을 수 있음 */
  display?: (unit?: string) => void;
  refresh?: (unit?: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

function getAdfitWindow(): AdfitWindow {
  return window as AdfitWindow;
}

function getAdfit(): AdfitApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return getAdfitWindow().adfit;
}

function safeAdfitCall(fn: () => void): void {
  try {
    fn();
  } catch {
    /* SDK 미지원·아직 init 전 */
  }
}

export function isAdfitPresent(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(getAdfit());
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

/** 클라이언트 hydration 직후 — 이미 로드된 ba.min.js ready 폴링 시작 */
export function bootstrapAdfitOnClient() {
  if (typeof window === 'undefined') return;
  startAdfitPoll();
}

/** window.adfit 폴링 — script 로드·캐시 모두 처리 */
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

export function invalidateAdfitReadyIfStale() {
  if (readyResolved && !isAdfitPresent()) {
    readyResolved = false;
    readyPromise = null;
  }
}

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

/**
 * SPA 탭 전환 등으로 슬롯이 DOM에서 제거될 때 해당 단위 인스턴스 정리.
 */
export function destroyAdUnit(unit: string): void {
  const unitId = unit.trim();
  if (!unitId) return;
  const adfit = getAdfit();
  if (!adfit?.destroy) return;
  safeAdfitCall(() => adfit.destroy!(unitId));
}

function invokeAdfitForUnit(adfit: AdfitApi, unit: string): boolean {
  if (adfit.render) {
    safeAdfitCall(() => adfit.render!(unit));
    return true;
  }
  if (adfit.display) {
    safeAdfitCall(() => adfit.display!(unit));
    return true;
  }
  if (adfit.refresh) {
    safeAdfitCall(() => adfit.refresh!(unit));
    return true;
  }
  return false;
}

/** DOM 내 모든 ins.kakao_ad_area — unit별 render */
export function scanAllAdfitSlots() {
  if (typeof document === 'undefined') return;
  const adfit = getAdfit();
  if (!adfit) return;

  if (adfit.render) {
    safeAdfitCall(() => adfit.render!());
    return;
  }

  for (const ins of document.querySelectorAll<HTMLElement>('ins.kakao_ad_area')) {
    const unit = ins.getAttribute('data-ad-unit')?.trim();
    if (unit) invokeAdfitForUnit(adfit, unit);
  }
}

export function renderAdUnit(unit?: string): void {
  const adfit = getAdfit();
  if (!adfit) return;
  const unitId = unit?.trim();
  if (unitId) {
    invokeAdfitForUnit(adfit, unitId);
    return;
  }
  scanAllAdfitSlots();
}

/** @deprecated renderAdUnit 사용 */
export function refreshAdUnit(unit?: string): void {
  renderAdUnit(unit);
}

/** @deprecated renderAdUnit 사용 */
export function displayAdUnit(unit?: string): void {
  renderAdUnit(unit);
}

/**
 * ins 마운트 후 unit render — 3~5회 백오프(~2.4s).
 * cleanup으로 unmount 시 재시도 중단.
 */
export function renderAdUnitWithBackoff(unit: string): () => void {
  let cancelled = false;
  let attempt = 0;

  const tick = () => {
    if (cancelled) return;
    const adfit = getAdfit();
    if (adfit && invokeAdfitForUnit(adfit, unit)) {
      attempt += 1;
      if (attempt < RENDER_MAX_ATTEMPTS) {
        setTimeout(tick, RENDER_BASE_DELAY_MS * attempt);
      }
      return;
    }
    attempt += 1;
    if (attempt <= RENDER_MAX_ATTEMPTS) {
      setTimeout(tick, RENDER_BASE_DELAY_MS * attempt);
    }
  };

  requestAnimationFrame(tick);
  return () => {
    cancelled = true;
  };
}

/** @deprecated renderAdUnitWithBackoff 사용 */
export function refreshAdUnitWithBackoff(unit: string): () => void {
  return renderAdUnitWithBackoff(unit);
}

export function requestAdfitRescan(unit?: string): void {
  renderAdUnit(unit);
}
