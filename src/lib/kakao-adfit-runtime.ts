/** Kakao AdFit ba.min.js — layout body 하단에서 정적 1회 로드 */

export const KAKAO_ADFIT_SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

type AdfitApi = {
  refresh?: (unit?: string) => void;
};

type AdfitWindow = Window & { adfit?: AdfitApi };

function getAdfit(): AdfitApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as AdfitWindow).adfit;
}

/**
 * 클라이언트 네비게이션 등으로 ins 슬롯이 교체된 뒤 SDK에 재스캔 요청.
 * 콜드 로드는 공식 ins+script 순서로 자동 처리되므로 destroy/폴링 불필요.
 */
export function requestAdfitRescan(): void {
  const adfit = getAdfit();
  if (!adfit?.refresh) return;
  try {
    adfit.refresh();
  } catch {
    /* refresh 미지원·아직 init 전 */
  }
}
