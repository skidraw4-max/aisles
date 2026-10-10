import { juryHref } from './jury-url';

export const PRODUCT_NAV = [
  { href: juryHref('/'), label: 'Dashboard' },
  { href: juryHref('/services'), label: 'Services' },
  { href: juryHref('/evidence'), label: 'Evidence' },
  { href: juryHref('/reviews'), label: 'Reviews' },
  { href: juryHref('/improvements'), label: 'Improvements' },
  { href: juryHref('/audit'), label: 'Audit' },
  { href: juryHref('/settings'), label: 'Settings' },
] as const;
