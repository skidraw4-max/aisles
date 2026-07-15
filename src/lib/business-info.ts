/**
 * 전자상거래법·표시광고법 등 사업자 정보 고시용 상수.
 * 값 변경 시 이 파일만 수정하면 Footer 등이 갱신된다.
 *
 * 출처: 사업자등록증(간이과세자) — 상호·대표·사업자번호·주소.
 * 통신판매업 신고번호는 등록증에 없음 → 신고 후 실제 번호로 교체 필요.
 */

export const BUSINESS_INFO = {
  /** 상호 */
  tradeName: '아일 스튜디오(Aisle Studio)',
  /** 대표자 성명 */
  representativeName: '함종두',
  /** 사업자등록번호 (표시용, 하이픈 포함) */
  businessRegistrationNumber: '238-52-01108',
  /**
   * 통신판매업 신고번호 — PLACEHOLDER.
   * 사업자등록증에 없음. 통신판매업 신고 완료 후 실제 번호로 교체할 것.
   * 예: 제2026-충남공주-0000호
   */
  mailOrderRegistrationNumber: '제OOOO-OOOO-OOOO호',
  /** 사업장 소재지 */
  address: '충청남도 공주시 신금2길 47-1, 104동 602호(신관동, 곰나루아파트)',
} as const;

/** 사업자번호 숫자만 (공정위 조회 wrkr_no) */
export function getBusinessRegistrationNumberDigits(): string {
  return BUSINESS_INFO.businessRegistrationNumber.replace(/\D/g, '');
}

/** 공정거래위원회 사업자정보확인 팝업 URL */
export function getFtcBizCommPopUrl(): string {
  const wrkrNo = getBusinessRegistrationNumberDigits();
  return `https://www.ftc.go.kr/bizCommPop.do?wrkr_no=${wrkrNo}`;
}
