/** Kakao AdFit ba.min.js — KakaoAdFitScript(body 하단)에서 1회 로드 */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 120;
const RENDER_RETRY_DELAYS_MS = [0, 200, 500, 1000];

export type AdfitApi = {
  destroy?: (unit: string) => void;
  render?: (unit?: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

function getAdfit(): AdfitApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as AdfitWindow).adfit;
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
  for (const listener of readyListeners) listener();
  readyListeners.clear();
}

function stopPoll() {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

/** Script onLoad 또는 이미 캐시된 ba.min.js */
export function onAdfitScriptLoad() {
  startAdfitPoll();
}

/** window.adfit 폴링 */
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

/** 단일 광고 단위 render — destroy 호출 금지 */
export function renderAdUnit(unit: string): void {
  const unitId = unit.trim();
  if (!unitId) return;
  const adfit = getAdfit();
  if (!adfit?.render) return;
  safeAdfitCall(() => adfit.render!(unitId));
}

/** DOM에 있는 모든 ins.kakao_ad_area 단위별 render */
export function renderAllAdfitUnitsInDom(): void {
  if (typeof document === 'undefined') return;
  const units = new Set<string>();
  for (const ins of document.querySelectorAll<HTMLElement>('ins.kakao_ad_area')) {
    const unit = ins.getAttribute('data-ad-unit')?.trim();
    if (unit) units.add(unit);
  }
  for (const unit of units) {
    renderAdUnit(unit);
  }
}

/**
 * ins 마운트·remountKey 변경 시 unit render — 몇 차례 재시도.
 * cleanup으로 unmount 시 재시도 중단.
 */
export function renderAdUnitWithRetry(unit: string): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;

  for (const delay of RENDER_RETRY_DELAYS_MS) {
    timers.push(
      setTimeout(() => {
        if (cancelled) return;
        whenAdfitReady(() => {
          if (cancelled) return;
          renderAdUnit(unit);
        });
      }, delay)
    );
  }

  return () => {
    cancelled = true;
    for (const t of timers) clearTimeout(t);
  };
}

const NAV_RESCAN_DELAYS_MS = [0, 150, 400, 800];

/** 홈 복도 탭 전환 후 DOM 갱신 뒤 보이는 슬롯만 unit별 render */
export function scheduleAdfitRescanAfterNav(): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const delay of NAV_RESCAN_DELAYS_MS) {
    timers.push(
      setTimeout(() => {
        whenAdfitReady(() => renderAllAdfitUnitsInDom());
      }, delay)
    );
  }
  return () => {
    for (const t of timers) clearTimeout(t);
  };
}
