type Props = {
  unit: string;
  width: number;
  height: number;
};

/** Kakao AdFit 공식 ins 마크업 — 스크립트는 KakaoAdFitLoader가 ins 뒤에 1회 주입 */
export function KakaoAdSlot({ unit, width, height }: Props) {
  return (
    <ins
      className="kakao_ad_area"
      style={{ display: 'none', width: '100%' }}
      data-ad-unit={unit}
      data-ad-width={String(width)}
      data-ad-height={String(height)}
    />
  );
}
