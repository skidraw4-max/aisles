import { isCapacitorNative } from '@/lib/capacitor-oauth';
import { AislesAd } from '@/lib/aisles-ad-plugin';

/** AdMob App ID (AndroidManifest strings.xml 과 동일) */
export const ADMOB_APP_ID = 'ca-app-pub-2237287742271246~5141113207';

export const ADMOB_BANNER_UNIT_ID = 'ca-app-pub-2237287742271246/6354915116';

export const ADMOB_APP_OPEN_UNIT_ID = 'ca-app-pub-2237287742271246/9608640126';

export const ADMOB_INTERSTITIAL_UNIT_ID = 'ca-app-pub-2237287742271246/9220751606';

/** @deprecated 네이티브 형식은 미사용 — MREC는 배너 유닛 + MEDIUM_RECTANGLE 로 요청 */
export const ADMOB_NATIVE_UNIT_ID = 'ca-app-pub-2237287742271246/3366328699';

/** Google 공식 Android 테스트 배너·MREC (adSize 로 크기 지정) */
const ANDROID_TEST_AD_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';

/** Google 공식 Android 테스트 App Open */
const ANDROID_TEST_APP_OPEN_UNIT_ID = 'ca-app-pub-3940256099942544/3419835294';

/** Google 공식 Android 테스트 전면 */
const ANDROID_TEST_INTERSTITIAL_UNIT_ID = 'ca-app-pub-3940256099942544/1033173712';

/** Capacitor 네이티브 앱에서 App Open 영구 비활성 (v1.2.0) */
const CAPACITOR_APP_OPEN_ADS_ENABLED = false;

/** Capacitor 네이티브 앱에서 전면 광고 영구 비활성 (v1.2.0) */
const CAPACITOR_INTERSTITIAL_ADS_ENABLED = false;

/** 전면: 보수적 트리거 — N회 라우트 이동 후 1회만 (세션당) */
export const INTERSTITIAL_NAVIGATION_THRESHOLD = 8;

/** App Open: WebView 초기 로드 후 표시까지 대기 (ms) */
const APP_OPEN_WEBVIEW_READY_DELAY_MS = 800;

/** MEDIUM_RECTANGLE CSS 크기 (300×250 dp) */
export const MREC_WIDTH_CSS = 300;
export const MREC_HEIGHT_CSS = 250;

/** 배너와 본문 사이 최소 간격 */
const BANNER_CONTENT_GAP_PX = 8;

/** AdMob 라벨·테두리 등으로 실제 시각 높이가 adSize.height 보다 클 수 있음 */
const BANNER_VISUAL_BUFFER_PX = 4;

const INSETS_CHANGED_EVENT = 'aisle:insets-changed';

const AUTH_PATH_PREFIXES = ['/login', '/auth'];

/** 헤더·상태바 아래 최소 여백 (측정 실패 시 폴백, CSS px ≈ dp) */
const MIN_TOP_FALLBACK_PX = 80;

const MIN_SLOT_VISIBILITY_RATIO = 0.5;

type BannerDisplayMode = 'none' | 'bottom' | 'infeed';

type InFeedSlotState = {
  element: HTMLElement;
  ratio: number;
  intersecting: boolean;
};

let initPromise: Promise<void> | null = null;
let interstitialShownThisSession = false;
let interstitialPreparePromise: Promise<void> | null = null;
let appOpenCyclePromise: Promise<void> | null = null;
let bannerDisplayMode: BannerDisplayMode = 'none';
let bottomBannerDesired = false;
let inFeedHidePromise: Promise<void> | null = null;
let sizeListenerRegistered = false;
let layoutListenerRegistered = false;

const inFeedSlots = new Map<number, InFeedSlotState>();
let inFeedObserver: IntersectionObserver | null = null;
let inFeedScrollRafId: number | null = null;
let inFeedScrollListenerCount = 0;
let inFeedGlobalScrollHandler: (() => void) | null = null;

export function shouldUseAdMobTestMode(): boolean {
  return process.env.NEXT_PUBLIC_ADMOB_TEST_MODE === 'true';
}

/** Capacitor 앱에서는 코드상 비활성. 웹 빌드 env 는 폐쇄 테스트용으로만 유지 */
export function isAppOpenAdEnabled(): boolean {
  if (isCapacitorNative()) return CAPACITOR_APP_OPEN_ADS_ENABLED;
  return process.env.NEXT_PUBLIC_ADMOB_APP_OPEN_ENABLED === 'true';
}

/** Capacitor 앱에서는 코드상 비활성. 웹 빌드 env 는 폐쇄 테스트용으로만 유지 */
export function isInterstitialAdEnabled(): boolean {
  if (isCapacitorNative()) return CAPACITOR_INTERSTITIAL_ADS_ENABLED;
  return process.env.NEXT_PUBLIC_ADMOB_INTERSTITIAL_ENABLED === 'true';
}

export function getBannerAdUnitId(): string {
  return shouldUseAdMobTestMode() ? ANDROID_TEST_AD_UNIT_ID : ADMOB_BANNER_UNIT_ID;
}

export function getAppOpenAdUnitId(): string {
  return shouldUseAdMobTestMode() ? ANDROID_TEST_APP_OPEN_UNIT_ID : ADMOB_APP_OPEN_UNIT_ID;
}

export function getInterstitialAdUnitId(): string {
  return shouldUseAdMobTestMode()
    ? ANDROID_TEST_INTERSTITIAL_UNIT_ID
    : ADMOB_INTERSTITIAL_UNIT_ID;
}

/** MREC도 동일 배너 유닛 ID + MEDIUM_RECTANGLE 로 요청 (AdMob 콘솔 별도 MREC 유닛은 선택) */
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

/**
 * Anchored adaptive 배너 높이 추정 (dp ≈ WebView CSS px).
 * @see https://developers.google.com/admob/android/banner/anchored-adaptive
 */
export function estimateAdaptiveBannerHeightPx(viewportWidthPx: number): number {
  const width = Math.max(320, Math.round(viewportWidthPx));
  if (width >= 728) return 90;
  if (width >= 468) return 60;
  return 50;
}

/**
 * 배너 시각 높이 + 시스템 하단 inset + 본문 간격.
 * edge-to-edge WebView(decorFitsSystemWindows false)에서 네이티브 배너는 내비게이션 바 위에
 * 오버레이되므로 본문 reserve 에 safe-area-bottom 을 포함합니다.
 */
export function computeBottomBannerReservePx(
  bannerVisualHeightPx: number,
  safeBottomPx = 0
): number {
  if (bannerVisualHeightPx <= 0) return 0;
  return Math.ceil(bannerVisualHeightPx + safeBottomPx + BANNER_CONTENT_GAP_PX);
}

function cssPxToDp(value: number): number {
  return Math.max(0, Math.round(value));
}

/** SiteHeader `<header>` 하단 — 인피드 MREC가 메뉴·헤더를 가리지 않도록 */
function measureMinSafeMarginTop(): number {
  if (typeof document === 'undefined') return MIN_TOP_FALLBACK_PX;

  const header = document.querySelector('header');
  if (header) {
    const bottom = header.getBoundingClientRect().bottom;
    if (bottom > 0) return Math.ceil(bottom);
  }

  const root = document.documentElement;
  const safeTop =
    parseFloat(getComputedStyle(root).getPropertyValue('--header-safe-area-top')) || 28;
  return Math.ceil(safeTop + 52);
}

function getBottomSafeInsetPx(): number {
  if (typeof document === 'undefined') return 0;
  return (
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--app-safe-area-bottom')
    ) || 0
  );
}

/**
 * Edge-to-edge WebView + Android 15+ community AdMob: BannerExecutor 가 bottomInset 을
 * 자동 적용하므로 JS margin 을 더하면 배너가 떠 보입니다 (MainActivity decorFitsSystemWindows false).
 */
function getBottomBannerMarginDp(): number {
  return 0;
}

function computeMrecDisplayRect(slotRect: DOMRect): DOMRect {
  const width = Math.min(MREC_WIDTH_CSS, Math.max(1, slotRect.width));
  const height = Math.min(MREC_HEIGHT_CSS, Math.max(1, slotRect.height));
  const left = slotRect.left + (slotRect.width - width) / 2;
  const top = slotRect.top;
  return new DOMRect(left, top, width, height);
}

function effectiveBannerVisualHeightPx(reportedAdHeightPx: number): number {
  if (reportedAdHeightPx <= 0) return 0;

  const safeBottom = getBottomSafeInsetPx();
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
  const estimated = estimateAdaptiveBannerHeightPx(viewportWidth);

  // 하단 배너 SizeChanged 가 safe-area 를 포함해 보고하는 경우 (#304)
  let adHeight = reportedAdHeightPx;
  if (safeBottom > 0 && reportedAdHeightPx > estimated + safeBottom - 4) {
    adHeight = reportedAdHeightPx - safeBottom;
  }

  return Math.ceil(Math.max(adHeight, estimated) + BANNER_VISUAL_BUFFER_PX);
}

function getInitialBottomBannerHeightPx(): number {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 360;
  return effectiveBannerVisualHeightPx(estimateAdaptiveBannerHeightPx(viewportWidth));
}

function updateBottomBannerReserve(bannerHeightPx: number): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const safeBottom = bannerHeightPx > 0 ? getBottomSafeInsetPx() : 0;
  const totalReserve = computeBottomBannerReservePx(bannerHeightPx, safeBottom);

  if (bannerHeightPx > 0) {
    root.style.setProperty('--app-ad-banner-height', `${bannerHeightPx}px`);
    root.style.setProperty('--app-ad-bottom-reserve', `${totalReserve}px`);
    return;
  }

  root.style.removeProperty('--app-ad-banner-height');
  root.style.setProperty('--app-ad-bottom-reserve', '0px');
}

function applyPluginBannerSize(reportedHeightPx: number): void {
  if (!bottomBannerDesired && bannerDisplayMode !== 'bottom') {
    if (reportedHeightPx <= 0) updateBottomBannerReserve(0);
    return;
  }
  if (reportedHeightPx > 0) {
    updateBottomBannerReserve(effectiveBannerVisualHeightPx(reportedHeightPx));
    return;
  }
  if (!bottomBannerDesired) {
    updateBottomBannerReserve(0);
  }
}

function measureBottomReservePx(): number {
  if (typeof document === 'undefined') return 0;
  const reserve =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--app-ad-bottom-reserve')
    ) || 0;
  return Math.ceil(reserve);
}

function refreshBottomBannerReserveFromCss(): void {
  if (!bottomBannerDesired || bannerDisplayMode !== 'bottom') return;
  const bannerH =
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--app-ad-banner-height')
    ) || getInitialBottomBannerHeightPx();
  updateBottomBannerReserve(bannerH);
}

/** safe-area·뷰포트 변경 시 CSS reserve 와 네이티브 배너 위치를 동기화 */
async function refreshBottomBannerNativeLayout(): Promise<void> {
  if (!bottomBannerDesired || bannerDisplayMode !== 'bottom' || !isCapacitorNative()) return;
  refreshBottomBannerReserveFromCss();
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.resumeBanner();
  } catch {
    // 배너 미표시·플러그인 오류는 무시
  }
}

function registerLayoutChangeListener(): void {
  if (layoutListenerRegistered || typeof window === 'undefined') return;
  const onLayoutChange = () => {
    void refreshBottomBannerNativeLayout();
  };
  window.addEventListener('resize', onLayoutChange);
  window.addEventListener('orientationchange', onLayoutChange);
  window.visualViewport?.addEventListener('resize', onLayoutChange);
  layoutListenerRegistered = true;
}

function registerInsetsChangedListener(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(INSETS_CHANGED_EVENT, () => {
    void refreshBottomBannerNativeLayout();
  });
}

function isSlotInSafeZone(rect: DOMRect): boolean {
  if (typeof window === 'undefined') return false;

  const minTop = measureMinSafeMarginTop();
  const maxTop = window.innerHeight - measureBottomReservePx() - MREC_HEIGHT_CSS;

  if (rect.top < minTop) return false;
  if (rect.top > maxTop) return false;
  if (rect.width < 1 || rect.height < 1) return false;

  return true;
}

async function registerBannerSizeListener(): Promise<void> {
  if (sizeListenerRegistered || typeof document === 'undefined') return;
  const { AdMob, BannerAdPluginEvents } = await import('@capacitor-community/admob');
  await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
    applyPluginBannerSize(size.height);
  });
  await AdMob.addListener(BannerAdPluginEvents.Loaded, () => {
    if (bottomBannerDesired && bannerDisplayMode === 'bottom') {
      refreshBottomBannerReserveFromCss();
    }
  });
  registerInsetsChangedListener();
  registerLayoutChangeListener();
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

function waitForWebViewReady(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.readyState === 'complete') {
    return new Promise((resolve) => setTimeout(resolve, APP_OPEN_WEBVIEW_READY_DELAY_MS));
  }
  return new Promise((resolve) => {
    const onReady = () => {
      window.removeEventListener('load', onReady);
      setTimeout(resolve, APP_OPEN_WEBVIEW_READY_DELAY_MS);
    };
    window.addEventListener('load', onReady);
  });
}

/** App Open 로드·표시 (v7 admob 미지원 → AislesAd 네이티브) */
export async function prepareAndShowAppOpenAd(): Promise<void> {
  if (!isCapacitorNative() || !isAppOpenAdEnabled()) return;
  if (appOpenCyclePromise) return appOpenCyclePromise;

  appOpenCyclePromise = (async () => {
    await initializeAdMob();
    await waitForWebViewReady();

    const { AislesAd } = await import('@/lib/aisles-ad-plugin');
    try {
      await AislesAd.prepareAppOpen({
        adId: getAppOpenAdUnitId(),
        isTesting: shouldUseAdMobTestMode(),
      });
      await AislesAd.showAppOpen();
    } catch {
      // 로드·표시 실패는 무시 (폐쇄 테스트 시에만 활성)
    }
  })().finally(() => {
    appOpenCyclePromise = null;
  });

  return appOpenCyclePromise;
}

async function prepareInterstitialAdInternal(): Promise<void> {
  if (!isCapacitorNative() || !isInterstitialAdEnabled()) return;
  if (interstitialPreparePromise) return interstitialPreparePromise;

  interstitialPreparePromise = (async () => {
    await initializeAdMob();
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.prepareInterstitial({
      adId: getInterstitialAdUnitId(),
      isTesting: shouldUseAdMobTestMode(),
    });
  })().finally(() => {
    interstitialPreparePromise = null;
  });

  return interstitialPreparePromise;
}

/** 전면 1회 표시 (세션당 최대 1회, 플래그 ON 시에만) */
export async function showInterstitialAdOnce(): Promise<boolean> {
  if (!isCapacitorNative() || !isInterstitialAdEnabled()) return false;
  if (interstitialShownThisSession) return false;

  try {
    await prepareInterstitialAdInternal();
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.showInterstitial();
    interstitialShownThisSession = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * 라우트 이동 횟수 기반 전면 트리거 (보수적).
 * `INTERSTITIAL_NAVIGATION_THRESHOLD` 회 이후 세션당 1회만 시도합니다.
 */
export async function maybeShowInterstitialAfterNavigation(
  navigationCount: number,
  pathname: string
): Promise<void> {
  if (!isInterstitialAdEnabled() || !isCapacitorNative()) return;
  if (interstitialShownThisSession) return;
  if (shouldHideAdsForPath(pathname)) return;
  if (navigationCount < INTERSTITIAL_NAVIGATION_THRESHOLD) return;

  await showInterstitialAdOnce();
}

async function hideInFeedMrecNative(): Promise<void> {
  if (!isCapacitorNative()) return;
  await AislesAd.hideMrec();
}

async function removeBottomBanner(): Promise<void> {
  const { AdMob } = await import('@capacitor-community/admob');
  await AdMob.removeBanner();
  updateBottomBannerReserve(0);
}

async function removeCurrentBanner(): Promise<void> {
  if (bannerDisplayMode === 'none') return;

  if (bannerDisplayMode === 'infeed') {
    await hideInFeedMrecNative();
  } else {
    await removeBottomBanner();
  }

  bannerDisplayMode = 'none';
}

/** 하단 고정 배너 표시 (BOTTOM_CENTER, Adaptive) */
export async function showBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  bottomBannerDesired = true;

  const eligibleInFeedSlot = pickBestInFeedSlot();
  if (eligibleInFeedSlot) {
    scheduleInFeedMrecSync();
    if (isInFeedMrecActive()) return;
    return;
  }

  if (isInFeedMrecActive()) {
    await hideInFeedMrec();
  }

  await initializeAdMob();

  const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');

  if (bannerDisplayMode === 'bottom') {
    if (
      !parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--app-ad-banner-height')
      )
    ) {
      updateBottomBannerReserve(getInitialBottomBannerHeightPx());
    }
    await AdMob.resumeBanner();
    return;
  }

  await removeCurrentBanner();

  bannerDisplayMode = 'bottom';
  updateBottomBannerReserve(getInitialBottomBannerHeightPx());

  await AdMob.showBanner({
    adId: getBannerAdUnitId(),
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: getBottomBannerMarginDp(),
    isTesting: shouldUseAdMobTestMode(),
  });
}

export async function hideBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  bottomBannerDesired = false;

  const { AdMob } = await import('@capacitor-community/admob');

  if (bannerDisplayMode === 'bottom') {
    await AdMob.hideBanner();
    updateBottomBannerReserve(0);
    return;
  }

  if (bannerDisplayMode === 'infeed') {
    await removeCurrentBanner();
  }
}

export async function resumeBannerAd(): Promise<void> {
  if (!isCapacitorNative() || !bottomBannerDesired) return;
  if (pickBestInFeedSlot()) {
    scheduleInFeedMrecSync();
    return;
  }
  await showBannerAd();
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
  if (typeof window === 'undefined') return;
  if (inFeedScrollRafId !== null) {
    cancelAnimationFrame(inFeedScrollRafId);
  }
  inFeedScrollRafId = requestAnimationFrame(() => {
    inFeedScrollRafId = null;
    void syncInFeedMrecDisplay();
  });
}

function ensureInFeedGlobalScrollListener(): void {
  if (inFeedGlobalScrollHandler || typeof window === 'undefined') return;

  const onScroll = () => scheduleInFeedMrecSync();
  inFeedGlobalScrollHandler = onScroll;
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onScroll);
  window.visualViewport?.addEventListener('scroll', onScroll);
  window.visualViewport?.addEventListener('resize', onScroll);
}

function releaseInFeedGlobalScrollListener(): void {
  if (!inFeedGlobalScrollHandler || typeof window === 'undefined') return;
  if (inFeedScrollListenerCount > 0) return;

  window.removeEventListener('scroll', inFeedGlobalScrollHandler, true);
  document.removeEventListener('scroll', inFeedGlobalScrollHandler, true);
  window.removeEventListener('resize', inFeedGlobalScrollHandler);
  window.visualViewport?.removeEventListener('scroll', inFeedGlobalScrollHandler);
  window.visualViewport?.removeEventListener('resize', inFeedGlobalScrollHandler);
  inFeedGlobalScrollHandler = null;
}

function pickBestInFeedSlot(): InFeedSlotState | null {
  let best: InFeedSlotState | null = null;
  let bestRatio = 0;

  for (const state of inFeedSlots.values()) {
    if (!state.intersecting || state.ratio < MIN_SLOT_VISIBILITY_RATIO) continue;

    const rect = state.element.getBoundingClientRect();
    if (!isSlotInSafeZone(rect)) continue;

    if (state.ratio > bestRatio) {
      best = state;
      bestRatio = state.ratio;
    }
  }

  return best;
}

async function showInFeedMrecAtRect(slotRect: DOMRect): Promise<void> {
  if (!isCapacitorNative()) return;

  const rect = computeMrecDisplayRect(slotRect);

  await initializeAdMob();

  if (bannerDisplayMode === 'bottom') {
    await removeBottomBanner();
    bannerDisplayMode = 'none';
  }

  await AislesAd.showMrecAtRect({
    adId: getMrecAdUnitId(),
    top: cssPxToDp(rect.top),
    left: cssPxToDp(rect.left),
    width: cssPxToDp(rect.width),
    height: cssPxToDp(rect.height),
    isTesting: shouldUseAdMobTestMode(),
  });

  bannerDisplayMode = 'infeed';
}

async function hideInFeedMrecInternal(): Promise<void> {
  if (bannerDisplayMode !== 'infeed') return;
  if (inFeedHidePromise) return inFeedHidePromise;

  inFeedHidePromise = (async () => {
    await hideInFeedMrecNative();
    bannerDisplayMode = 'none';
  })().finally(() => {
    inFeedHidePromise = null;
  });

  return inFeedHidePromise;
}

export async function hideInFeedMrec(): Promise<void> {
  await hideInFeedMrecInternal();
}

async function restoreBottomBannerIfNeeded(): Promise<void> {
  if (!bottomBannerDesired || pickBestInFeedSlot()) return;
  await showBannerAd();
}

async function syncInFeedMrecDisplay(): Promise<void> {
  if (!isCapacitorNative()) return;

  const best = pickBestInFeedSlot();

  if (!best) {
    if (bannerDisplayMode === 'infeed') {
      await hideInFeedMrecInternal();
      await restoreBottomBannerIfNeeded();
    }
    return;
  }

  const rect = best.element.getBoundingClientRect();
  if (!isSlotInSafeZone(rect)) {
    if (bannerDisplayMode === 'infeed') {
      await hideInFeedMrecInternal();
      await restoreBottomBannerIfNeeded();
    }
    return;
  }

  void showInFeedMrecAtRect(rect);
}

/**
 * 인피드 MREC 슬롯 DOM을 등록합니다.
 * 전역에서 가시성이 가장 높은 슬롯 1개만 네이티브 배너로 표시합니다.
 */
export function registerInFeedMrecSlot(slotIndex: number, element: HTMLElement): () => void {
  if (!isCapacitorNative()) return () => {};

  ensureInFeedObserver();
  ensureInFeedGlobalScrollListener();
  inFeedScrollListenerCount += 1;
  element.dataset.adSlotIndex = String(slotIndex);
  inFeedSlots.set(slotIndex, { element, ratio: 0, intersecting: false });
  inFeedObserver!.observe(element);

  scheduleInFeedMrecSync();

  return () => {
    inFeedSlots.delete(slotIndex);
    inFeedObserver?.unobserve(element);
    inFeedScrollListenerCount = Math.max(0, inFeedScrollListenerCount - 1);
    releaseInFeedGlobalScrollListener();
    scheduleInFeedMrecSync();
  };
}
