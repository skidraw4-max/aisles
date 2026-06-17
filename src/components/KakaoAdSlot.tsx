type Props = {
  unit: string;
  width: number;
  height: number;
};

/** Kakao AdFit ins 마크업 — ba.min.js는 KakaoAdFitLoader가 마지막 ins 뒤에 주입 */
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
