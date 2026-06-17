/** Kakao AdFit ba.min.js — layout body 하단에서 정적 1회 로드 */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

type AdfitApi = {
  destroy?: (unit: string) => void;
  refresh?: (unit?: string) => void;
  display?: (unit?: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

function getAdfit(): AdfitApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as AdfitWindow).adfit;
}

function safeAdfitCall(fn: () => void): void {
  try {
    fn();
  } catch {
    /* SDK 미지원·아직 init 전 */
  }
}

/**
 * SPA 탭 전환 등으로 슬롯이 DOM에서 제거될 때 해당 단위 인스턴스 정리.
 * 콜드 로드(최초 HTML+script)에서는 SDK가 자동 스캔하므로 호출 불필요.
 */
export function destroyAdUnit(unit: string): void {
  const unitId = unit.trim();
  if (!unitId) return;
  const adfit = getAdfit();
  if (!adfit?.destroy) return;
  safeAdfitCall(() => adfit.destroy!(unitId));
}

/**
 * SPA 마운트 후 특정 단위 재스캔. unit 생략 시 전체 refresh(레거시).
 * 콜드 로드는 ins+script 순서로 자동 처리되며, SPA에서는 마운트 직후 호출.
 */
export function refreshAdUnit(unit?: string): void {
  const adfit = getAdfit();
  if (!adfit?.refresh) return;
  const unitId = unit?.trim();
  safeAdfitCall(() => adfit.refresh!(unitId || undefined));
}

/**
 * SPA 마운트 후 특정 단위 표시 트리거(display 지원 시).
 */
export function displayAdUnit(unit?: string): void {
  const adfit = getAdfit();
  if (!adfit?.display) return;
  const unitId = unit?.trim();
  safeAdfitCall(() => adfit.display!(unitId || undefined));
}

/**
 * 클라이언트 네비게이션 등으로 ins 슬롯이 교체된 뒤 SDK에 재스캔 요청.
 * unit이 있으면 단위별 refresh→display, 없으면 전체 refresh.
 * 콜드 로드는 공식 ins+script 순서로 자동 처리되므로 destroy/폴링 불필요.
 */
export function requestAdfitRescan(unit?: string): void {
  const unitId = unit?.trim();
  if (unitId) {
    refreshAdUnit(unitId);
    displayAdUnit(unitId);
    return;
  }
  refreshAdUnit();
}
