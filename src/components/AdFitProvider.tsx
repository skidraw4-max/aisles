'use client';

import { createContext, useContext, type ReactNode } from 'react';

type AdFitContextValue = {
  /** @deprecated ba.min.js는 layout에서 정적 로드 — 컨텍스트는 하위 호환용 */
  scriptReady: boolean;
};

const AdFitContext = createContext<AdFitContextValue>({ scriptReady: true });

export function useAdFitReady(): AdFitContextValue {
  return useContext(AdFitContext);
}

/** 웹 AdFit 래퍼 — 마운트 시 구조가 바뀌지 않도록 항상 동일 Provider 트리 유지 */
export function AdFitProvider({ children }: { children: ReactNode }) {
  return (
    <AdFitContext.Provider value={{ scriptReady: true }}>{children}</AdFitContext.Provider>
  );
}
