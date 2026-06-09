import { isCapacitorNative } from '@/lib/capacitor-oauth';

/** AdMob App ID (AndroidManifest strings.xml 과 동일) */
export const ADMOB_APP_ID = 'ca-app-pub-2237287742271246~5141113207';

export const ADMOB_BANNER_UNIT_ID = 'ca-app-pub-2237287742271246/6354915116';

/** @deprecated 네이티브 형식은 미사용 — MREC는 배너 유닛 + MEDIUM_RECTANGLE 로 요청 */
export const ADMOB_NATIVE_UNIT_ID = 'ca-app-pub-2237287742271246/3366328699';

/** Google 공식 Android 테스트 배너·MREC (adSize 로 크기 지정) */
const ANDROID_TEST_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';

/** MEDIUM_RECTANGLE CSS 높이 (300×250 dp) */
const MREC_HEIGHT_CSS = 250;

const AUTH_PATH_PREFIXES = ['/login', '/auth'];

type BannerDisplayMode = 'none' | 'bottom' | 'infeed';

type InFeedSlotState = {
  element: HTMLElement;
  ratio: number;
  intersecting: boolean;
};

let initPromise: Promise<void> | null = null;
let bannerDisplayMode: BannerDisplayMode = 'none';
let bottomBannerDesired = false;
let inFeedMarginPx: number | null = null;
let inFeedSyncPromise: Promise<void> | null = null;
let sizeListenerRegistered = false;

const inFeedSlots = new Map<number, InFeedSlotState>();
let inFeedObserver: IntersectionObserver | null = null;
let inFeedScrollScheduled = false;

export function shouldUseAdMobTestMode(): boolean {
  return process.env.NEXT_PUBLIC_ADMOB_TEST_MODE === 'true';
}

export function getBannerAdUnitId(): string {
  return shouldUseAdMobTestMode() ? ANDROID_TEST_AD_UNIT_ID : ADMOB_BANNER_UNIT_ID;
}

/** MREC도 동일 배너 유닛 ID + BannerAdSize.MEDIUM_RECTANGLE 로 요청 (AdMob 콘솔 별도 MREC 유닛은 선택) */
export function getMrecAdUnitId(): string {
  return getBannerAdUnitId();
}

export function shouldHideAdsForPath(pathname: string): boolean {
  return AUTH_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isInFeedMrecActive(): boolean {
  return bannerDisplayMode === 'infeed';
}

async function registerBannerSizeListener(): Promise<void> {
  if (sizeListenerRegistered || typeof document === 'undefined') return;
  const { AdMob, BannerAdPluginEvents } = await import('@capacitor-community/admob');
  await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
    if (bannerDisplayMode !== 'bottom') return;
    document.documentElement.style.setProperty('--app-ad-banner-height', `${size.height}px`);
  });
  sizeListenerRegistered = true;
}

/** AdMob SDK 1회 초기화 (Capacitor 네이티브 전용) */
export async function initializeAdMob(): Promise<void> {
  if (!isCapacitorNative()) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.initialize({
      initializeForTesting: shouldUseAdMobTestMode(),
    });
    await registerBannerSizeListener();
  })();

  return initPromise;
}

async function removeCurrentBanner(): Promise<void> {
  if (bannerDisplayMode === 'none') return;
  const { AdMob } = await import('@capacitor-community/admob');
  await AdMob.removeBanner();
  bannerDisplayMode = 'none';
  inFeedMarginPx = null;
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--app-ad-banner-height');
  }
}

/** 하단 고정 배너 표시 (BOTTOM_CENTER, Adaptive) */
export async function showBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  bottomBannerDesired = true;
  if (isInFeedMrecActive() || pickBestInFeedSlot()) return;

  await initializeAdMob();

  const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');

  if (bannerDisplayMode === 'bottom') {
    await AdMob.resumeBanner();
    return;
  }

  await removeCurrentBanner();

  await AdMob.showBanner({
    adId: getBannerAdUnitId(),
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 0,
    isTesting: shouldUseAdMobTestMode(),
  });
  bannerDisplayMode = 'bottom';
}

export async function hideBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  bottomBannerDesired = false;

  const { AdMob } = await import('@capacitor-community/admob');

  if (bannerDisplayMode === 'bottom') {
    await AdMob.hideBanner();
    return;
  }

  if (bannerDisplayMode === 'infeed') {
    await removeCurrentBanner();
  }
}

export async function resumeBannerAd(): Promise<void> {
  if (!isCapacitorNative() || bannerDisplayMode !== 'bottom') return;
  const { AdMob } = await import('@capacitor-community/admob');
  await AdMob.resumeBanner();
}

export async function removeBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  bottomBannerDesired = false;
  await removeCurrentBanner();
}

function ensureInFeedObserver(): void {
  if (inFeedObserver || typeof IntersectionObserver === 'undefined') return;

  inFeedObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const slotIndex = Number(el.dataset.adSlotIndex);
        if (Number.isNaN(slotIndex)) continue;
        const state = inFeedSlots.get(slotIndex);
        if (!state) continue;
        state.intersecting = entry.isIntersecting;
        state.ratio = entry.intersectionRatio;
      }
      scheduleInFeedMrecSync();
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
}

function scheduleInFeedMrecSync(): void {
  if (inFeedScrollScheduled || typeof window === 'undefined') return;
  inFeedScrollScheduled = true;
  requestAnimationFrame(() => {
    inFeedScrollScheduled = false;
    void syncInFeedMrecDisplay();
  });
}

function pickBestInFeedSlot(): InFeedSlotState | null {
  let best: InFeedSlotState | null = null;
  let bestRatio = 0;

  for (const state of inFeedSlots.values()) {
    if (!state.intersecting || state.ratio < 0.35) continue;
    if (state.ratio > bestRatio) {
      best = state;
      bestRatio = state.ratio;
    }
  }

  return best;
}

async function showInFeedMrecAtMargin(marginTop: number): Promise<void> {
  if (!isCapacitorNative()) return;

  if (
    bannerDisplayMode === 'infeed' &&
    inFeedMarginPx !== null &&
    Math.abs(inFeedMarginPx - marginTop) < 8
  ) {
    return;
  }

  await initializeAdMob();

  const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');

  await removeCurrentBanner();

  await AdMob.showBanner({
    adId: getMrecAdUnitId(),
    adSize: BannerAdSize.MEDIUM_RECTANGLE,
    position: BannerAdPosition.TOP_CENTER,
    margin: marginTop,
    isTesting: shouldUseAdMobTestMode(),
  });

  bannerDisplayMode = 'infeed';
  inFeedMarginPx = marginTop;
}

export async function hideInFeedMrec(): Promise<void> {
  if (bannerDisplayMode !== 'infeed') return;
  await removeCurrentBanner();
}

async function restoreBottomBannerIfNeeded(): Promise<void> {
  if (!bottomBannerDesired || pickBestInFeedSlot()) return;
  await showBannerAd();
}

async function syncInFeedMrecDisplay(): Promise<void> {
  if (!isCapacitorNative()) return;
  if (inFeedSyncPromise) return inFeedSyncPromise;

  inFeedSyncPromise = (async () => {
    const best = pickBestInFeedSlot();

    if (!best) {
      if (bannerDisplayMode === 'infeed') {
        await hideInFeedMrec();
        await restoreBottomBannerIfNeeded();
      }
      return;
    }

    const rect = best.element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const marginTop = Math.round(rect.top + Math.max(0, (rect.height - MREC_HEIGHT_CSS) / 2));
    await showInFeedMrecAtMargin(marginTop);
  })().finally(() => {
    inFeedSyncPromise = null;
  });

  return inFeedSyncPromise;
}

/**
 * 인피드 MREC 슬롯 DOM을 등록합니다.
 * IntersectionObserver + 스크롤 시 네이티브 MEDIUM_RECTANGLE 배너를 슬롯 위치에 맞춥니다.
 */
export function registerInFeedMrecSlot(slotIndex: number, element: HTMLElement): () => void {
  if (!isCapacitorNative()) return () => {};

  ensureInFeedObserver();
  element.dataset.adSlotIndex = String(slotIndex);
  inFeedSlots.set(slotIndex, { element, ratio: 0, intersecting: false });
  inFeedObserver!.observe(element);

  const onLayoutChange = () => scheduleInFeedMrecSync();
  window.addEventListener('scroll', onLayoutChange, { passive: true });
  window.addEventListener('resize', onLayoutChange);

  scheduleInFeedMrecSync();

  return () => {
    inFeedSlots.delete(slotIndex);
    inFeedObserver?.unobserve(element);
    window.removeEventListener('scroll', onLayoutChange);
    window.removeEventListener('resize', onLayoutChange);
    scheduleInFeedMrecSync();
  };
}
