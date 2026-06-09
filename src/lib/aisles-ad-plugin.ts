import { registerPlugin } from '@capacitor/core';

export type AislesAdRectOptions = {
  adId: string;
  top: number;
  left: number;
  width: number;
  height: number;
  isTesting?: boolean;
};

export type AislesAdAppOpenOptions = {
  adId: string;
  isTesting?: boolean;
};

export interface AislesAdPlugin {
  showMrecAtRect(options: AislesAdRectOptions): Promise<void>;
  hideMrec(): Promise<void>;
  /** v7 @capacitor-community/admob 에 App Open 미지원 — 네이티브 AppOpenAd 로드 */
  prepareAppOpen(options: AislesAdAppOpenOptions): Promise<void>;
  showAppOpen(): Promise<void>;
}

export const AislesAd = registerPlugin<AislesAdPlugin>('AislesAd', {
  web: () => import('./aisles-ad-plugin.web').then((m) => m.default),
});
