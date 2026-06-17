'use client';

import Script from 'next/script';
import { KAKAO_ADFIT_SCRIPT_SRC, onAdfitScriptLoad } from '@/lib/kakao-adfit-runtime';

/**
 * Kakao AdFit ba.min.js — body 맨 아래·모든 ins 뒤 1회 로드 (공식 설치 순서).
 */
export function KakaoAdFitScript() {
  return (
    <Script
      id="kakao-adfit-ba"
      src={KAKAO_ADFIT_SCRIPT_SRC}
      strategy="afterInteractive"
      charSet="utf-8"
      onLoad={() => {
        onAdfitScriptLoad();
      }}
    />
  );
}
