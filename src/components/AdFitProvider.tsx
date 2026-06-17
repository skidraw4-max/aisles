'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Script from 'next/script';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  KAKAO_ADFIT_SCRIPT_SRC,
  isAdfitPresent,
  onAdfitScriptLoad,
  startAdfitPoll,
} from '@/lib/kakao-adfit-runtime';

type AdFitContextValue = {
  /** window.adfit 사용 가능 */
  scriptReady: boolean;
};

const AdFitContext = createContext<AdFitContextValue>({ scriptReady: false });

export function useAdFitReady(): AdFitContextValue {
  return useContext(AdFitContext);
}

/**
 * 웹 전용 Kakao AdFit ba.min.js — root layout에서 1회 로드.
 * Capacitor 네이티브는 스크립트·컨텍스트 모두 생략(AdMob 사용).
 */
export function AdFitProvider({ children }: { children: ReactNode }) {
  const [isWeb, setIsWeb] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (isCapacitorNative()) return;
    setIsWeb(true);
    if (isAdfitPresent()) {
      onAdfitScriptLoad();
      setScriptReady(true);
    }
  }, []);

  useEffect(() => {
    if (!isWeb || scriptReady) return;
    const id = window.setInterval(() => {
      if (isAdfitPresent()) {
        setScriptReady(true);
        window.clearInterval(id);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [isWeb, scriptReady]);

  const value = useMemo(() => ({ scriptReady }), [scriptReady]);

  if (!isWeb) {
    return <>{children}</>;
  }

  return (
    <AdFitContext.Provider value={value}>
      <Script
        id="kakao-adfit-ba"
        src={KAKAO_ADFIT_SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={() => {
          onAdfitScriptLoad();
          setScriptReady(true);
        }}
        onReady={() => {
          onAdfitScriptLoad();
          if (isAdfitPresent()) setScriptReady(true);
        }}
        onError={() => {
          startAdfitPoll();
        }}
      />
      {children}
    </AdFitContext.Provider>
  );
}
