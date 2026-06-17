/** Kakao AdFit ba.min.js — ins 뒤에 1회 주입 (KakaoAdFitLoader) */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const SCRIPT_MARKER = 'data-aisle-kakao-adfit';
const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 120;
const NAV_RESCAN_DELAYS_MS = [0, 200, 500, 1000, 2000, 3500, 5000];

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
let rescanGeneration = 0;

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

export function onAdfitScriptLoad() {
  startAdfitPoll();
}

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

/** DOM 내 모든 ins.kakao_ad_area — render() 1회만 (per-unit 중복 호출 금지) */
export function scanAllAdfitSlots(): void {
  if (typeof document === 'undefined') return;
  const adfit = getAdfit();
  if (!adfit?.render) return;
  safeAdfitCall(() => adfit.render!());
}

/** ins가 DOM에서 제거될 때 해당 unit만 정리 — 동일 unit ID 재마운트(ALL↔복도)에 필요 */
export function destroyAdUnit(unit: string): void {
  const unitId = unit.trim();
  if (!unitId) return;
  const adfit = getAdfit();
  if (!adfit?.destroy) return;
  safeAdfitCall(() => adfit.destroy!(unitId));
}

/** @deprecated scanAllAdfitSlots 사용 */
export function renderAllAdfitUnitsInDom(): void {
  scanAllAdfitSlots();
}

function getAdfitScriptEl(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
}

/**
 * ins가 DOM에 있을 때 마지막 ins 바로 뒤에 ba.min.js 1회 주입.
 * 이미 주입됐으면 재배치하지 않음 — SPA 탭 전환마다 script 이동 시 SDK 상태가 깨짐.
 */
export function ensureAdfitScriptAfterSlots(): boolean {
  if (typeof document === 'undefined') return false;

  const insList = document.querySelectorAll<HTMLElement>('ins.kakao_ad_area');
  if (insList.length === 0) return false;

  const lastIns = insList[insList.length - 1];
  const existing = getAdfitScriptEl();

  if (existing) {
    return true;
  }

  const script = document.createElement('script');
  script.async = true;
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.src = KAKAO_ADFIT_SCRIPT_SRC;
  script.setAttribute(SCRIPT_MARKER, '1');
  script.onload = () => {
    onAdfitScriptLoad();
    whenAdfitReady(() => scanAllAdfitSlots());
  };
  lastIns.after(script);
  return true;
}

/**
 * 홈 복도 탭 전환 후 DOM 갱신 뒤 1회 스캔 (연속 호출은 coalesce).
 * destroy 없이 render()만 — SDK가 현재 ins에 재바인딩.
 */
export function scheduleAdfitRescanAfterNav(): () => void {
  rescanGeneration += 1;
  const generation = rescanGeneration;
  const timers = NAV_RESCAN_DELAYS_MS.map((delay) =>
    setTimeout(() => {
      if (generation !== rescanGeneration) return;
      ensureAdfitScriptAfterSlots();
      whenAdfitReady(() => scanAllAdfitSlots());
    }, delay)
  );
  return () => {
    for (const timer of timers) clearTimeout(timer);
  };
}
