import { registerPlugin } from '@capacitor/core';

export type AislesAdRectOptions = {
  adId: string;
  top: number;
  left: number;
  width: number;
  height: number;
  isTesting?: boolean;
};

export interface AislesAdPlugin {
  showMrecAtRect(options: AislesAdRectOptions): Promise<void>;
  hideMrec(): Promise<void>;
}

export const AislesAd = registerPlugin<AislesAdPlugin>('AislesAd', {
  web: () => import('./aisles-ad-plugin.web').then((m) => m.default),
});
