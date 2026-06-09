import { isCapacitorNative } from '@/lib/capacitor-oauth';

/** AdMob App ID (AndroidManifest strings.xml 과 동일) */
export const ADMOB_APP_ID = 'ca-app-pub-2237287742271246~5141113207';

export const ADMOB_BANNER_UNIT_ID = 'ca-app-pub-2237287742271246/6354915116';

/** @capacitor-community/admob 는 Native 형식 미지원 — 향후 커스텀 브리지용 */
export const ADMOB_NATIVE_UNIT_ID = 'ca-app-pub-2237287742271246/3366328699';

/** Google 공식 Android 테스트 배너 (Adaptive) */
const ANDROID_TEST_BANNER_UNIT_ID = 'ca-app-pub-3940256099942544/6300978111';

const AUTH_PATH_PREFIXES = ['/login', '/auth'];

let initPromise: Promise<void> | null = null;
let bannerMounted = false;
let sizeListenerRegistered = false;

export function shouldUseAdMobTestMode(): boolean {
  return process.env.NEXT_PUBLIC_ADMOB_TEST_MODE === 'true';
}

export function getBannerAdUnitId(): string {
  return shouldUseAdMobTestMode() ? ANDROID_TEST_BANNER_UNIT_ID : ADMOB_BANNER_UNIT_ID;
}

export function shouldHideAdsForPath(pathname: string): boolean {
  return AUTH_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

async function registerBannerSizeListener(): Promise<void> {
  if (sizeListenerRegistered || typeof document === 'undefined') return;
  const { AdMob, BannerAdPluginEvents } = await import('@capacitor-community/admob');
  await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
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

/** 하단 고정 배너 표시 (BOTTOM_CENTER, Adaptive) */
export async function showBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  await initializeAdMob();

  const { AdMob, BannerAdSize, BannerAdPosition } = await import('@capacitor-community/admob');

  if (bannerMounted) {
    await AdMob.resumeBanner();
    return;
  }

  await AdMob.showBanner({
    adId: getBannerAdUnitId(),
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 0,
    isTesting: shouldUseAdMobTestMode(),
  });
  bannerMounted = true;
}

export async function hideBannerAd(): Promise<void> {
  if (!isCapacitorNative() || !bannerMounted) return;
  const { AdMob } = await import('@capacitor-community/admob');
  await AdMob.hideBanner();
}

export async function resumeBannerAd(): Promise<void> {
  if (!isCapacitorNative() || !bannerMounted) return;
  const { AdMob } = await import('@capacitor-community/admob');
  await AdMob.resumeBanner();
}

export async function removeBannerAd(): Promise<void> {
  if (!isCapacitorNative()) return;
  const { AdMob } = await import('@capacitor-community/admob');
  if (bannerMounted) {
    await AdMob.removeBanner();
    bannerMounted = false;
  }
  document.documentElement.style.removeProperty('--app-ad-banner-height');
}

/**
 * 인피드 네이티브 광고 — 커뮤니티 플러그인 미지원.
 * 슬롯·유닛 ID만 준비해 두었으며, 향후 커스텀 Capacitor 플러그인에서 사용합니다.
 */
export async function prepareNativeAdSlot(): Promise<void> {
  if (!isCapacitorNative()) return;
  await initializeAdMob();
}
