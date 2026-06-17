'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isCapacitorNative } from '@/lib/capacitor-oauth';
import {
  isAdfitPresent,
  onAdfitScriptLoad,
  startAdfitPoll,
  whenAdfitReady,
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
 * 웹 전용 AdFit ready 컨텍스트 — ba.min.js는 root layout(beforeInteractive)에서 1회 로드.
 * Capacitor 네이티브는 스크립트·컨텍스트 모두 생략(AdMob 사용).
 */
export function AdFitProvider({ children }: { children: ReactNode }) {
  const [isWeb, setIsWeb] = useState(false);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (isCapacitorNative()) return;
    setIsWeb(true);
    startAdfitPoll();
    if (isAdfitPresent()) {
      onAdfitScriptLoad();
      setScriptReady(true);
      return;
    }
    whenAdfitReady(() => setScriptReady(true));
  }, []);

  const value = useMemo(() => ({ scriptReady }), [scriptReady]);

  if (!isWeb) {
    return <>{children}</>;
  }

  return <AdFitContext.Provider value={value}>{children}</AdFitContext.Provider>;
}
