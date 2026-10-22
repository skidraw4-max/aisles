'use client';

import Script from 'next/script';
import { isCapacitorNative } from '@/lib/capacitor-oauth';

const ADSENSE_CLIENT_ID = 'ca-pub-2237287742271246';

/** 웹 브라우저 전용 AdSense 로더. Capacitor 앱은 Kakao AdFit만 사용합니다. */
export function AdSenseScript() {
  if (isCapacitorNative()) return null;

  return (
    <Script
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT_ID}`}
      strategy="lazyOnload"
      crossOrigin="anonymous"
    />
  );
}
