import { juryHref } from './jury-url';

export const PRODUCT_NAV = [
  { href: juryHref('/'), label: '홈' },
  { href: juryHref('/evidence'), label: '리뷰 요청' },
  { href: juryHref('/reviews'), label: '결과' },
  { href: juryHref('/settings'), label: '관리' },
] as const;
