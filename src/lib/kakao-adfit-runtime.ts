/** Kakao AdFit ba.min.js — ins 뒤에 주입 (KakaoAdFitLoader) */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const SCRIPT_MARKER = 'data-aisle-kakao-adfit';
const ADFIT_POLL_INTERVAL_MS = 50;
const ADFIT_POLL_MAX_ATTEMPTS = 120;

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
  renderAllAdfitUnitsInDom();
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

export function renderAdUnit(unit: string): void {
  const unitId = unit.trim();
  if (!unitId) return;
  const adfit = getAdfit();
  if (!adfit?.render) return;
  safeAdfitCall(() => adfit.render!(unitId));
}

export function renderAllAdfitUnitsInDom(): void {
  if (typeof document === 'undefined') return;
  const units = new Set<string>();
  for (const ins of document.querySelectorAll<HTMLElement>('ins.kakao_ad_area')) {
    const unit = ins.getAttribute('data-ad-unit')?.trim();
    if (unit) units.add(unit);
  }
  const adfit = getAdfit();
  if (adfit?.render) {
    safeAdfitCall(() => adfit.render!());
  }
  for (const unit of units) {
    renderAdUnit(unit);
  }
}

function getAdfitScriptEl(): HTMLScriptElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
}

function isScriptImmediatelyAfterIns(script: HTMLScriptElement, ins: HTMLElement): boolean {
  let node: ChildNode | null = ins.nextSibling;
  while (node && node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
    node = node.nextSibling;
  }
  return node === script;
}

/**
 * ins가 DOM에 있을 때만 마지막 ins 바로 뒤에 ba.min.js 주입·재배치.
 * 탭 전환으로 ins가 remount되면 script를 새 ins 뒤로 옮김.
 */
export function ensureAdfitScriptAfterSlots(): boolean {
  if (typeof document === 'undefined') return false;

  const insList = document.querySelectorAll<HTMLElement>('ins.kakao_ad_area');
  if (insList.length === 0) return false;

  const lastIns = insList[insList.length - 1];
  const existing = getAdfitScriptEl();

  if (existing) {
    if (!isScriptImmediatelyAfterIns(existing, lastIns)) {
      lastIns.after(existing);
    }
    if (isAdfitPresent()) {
      whenAdfitReady(() => renderAllAdfitUnitsInDom());
    }
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
    whenAdfitReady(() => renderAllAdfitUnitsInDom());
  };
  lastIns.after(script);
  return true;
}
