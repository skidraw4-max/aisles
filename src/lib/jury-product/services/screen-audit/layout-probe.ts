/**
 * I-059/I-061: in-page layout measurement for the screen audit. Returns numbers and element boxes only — never text,
 * values, attributes or URLs. Runs inside the page via page.evaluate (kept free of Node globals).
 */
export type Box = { x: number; y: number; w: number; h: number };
export type ContrastSample = { ratio: number; large: boolean; box: Box };
export type LayoutMetrics = {
  viewportWidth: number;
  viewportHeight: number;
  docWidth: number;
  docHeight: number;
  /** elements whose right edge passes the viewport (horizontal overflow), max 20 boxes. */
  overflowBoxes: Box[];
  /** text containers whose content is clipped (scrollWidth > clientWidth with overflow hidden / ellipsis), max 20. */
  clippedBoxes: Box[];
  /** visible interactive elements (a, button, input, select, [role=button]) boxes, max 150. */
  interactive: Box[];
  /** text contrast samples below 7:1 only (max 40). */
  lowContrast: ContrastSample[];
  textSamples: number;
  navVisible: boolean;
  searchVisible: boolean;
  headings: number;
};

export const LAYOUT_PROBE = (): LayoutMetrics => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  const doc = g.document;
  const vw: number = g.innerWidth;
  const vh: number = g.innerHeight;
  const boxOf = (el: any): Box => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top + g.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const visible = (el: any) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = g.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const all: any[] = Array.from(doc.querySelectorAll('body *')).slice(0, 4000);
  const overflowBoxes: Box[] = [];
  const clippedBoxes: Box[] = [];
  for (const el of all) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (overflowBoxes.length < 20 && r.right > vw + 1 && r.left < vw && r.width <= vw * 3) {
      const pos = g.getComputedStyle(el).position;
      if (pos !== 'fixed') overflowBoxes.push(boxOf(el));
    }
    if (clippedBoxes.length < 20 && el.childElementCount === 0 && (el.textContent || '').trim().length > 0) {
      const s = g.getComputedStyle(el);
      if ((s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1) clippedBoxes.push(boxOf(el));
    }
  }
  const interactive: Box[] = [];
  for (const el of Array.from(doc.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]')) as any[]) {
    if (interactive.length >= 150) break;
    if (visible(el)) interactive.push(boxOf(el));
  }
  const parse = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = (rgb: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
  };
  const bgOf = (el: any): number[] => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(g.getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.9) return c;
      if (g.getComputedStyle(n).backgroundImage !== 'none') return [];
    }
    return [255, 255, 255, 1];
  };
  const lowContrast: ContrastSample[] = [];
  let textSamples = 0;
  for (const el of all) {
    if (textSamples >= 300) break;
    if (el.childElementCount > 0 || (el.textContent || '').trim().length < 2 || !visible(el)) continue;
    textSamples += 1;
    const s = g.getComputedStyle(el);
    const fg = parse(s.color);
    const bg = bgOf(el);
    if (!fg || bg.length === 0) continue;
    const a = lum(fg);
    const b = lum(bg);
    const ratio = Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < 7 && lowContrast.length < 40) lowContrast.push({ ratio, large, box: boxOf(el) });
  }
  const anyVisible = (sel: string) => (Array.from(doc.querySelectorAll(sel)) as any[]).some(visible);
  return {
    viewportWidth: vw,
    viewportHeight: vh,
    docWidth: doc.documentElement.scrollWidth,
    docHeight: doc.documentElement.scrollHeight,
    overflowBoxes,
    clippedBoxes,
    interactive,
    lowContrast,
    textSamples,
    navVisible: anyVisible('nav, [role="navigation"], header a[href], [class*="menu" i] a[href]'),
    searchVisible: anyVisible('input[type="search"], [role="search"], input[name*="search" i], input[placeholder*="검색"]'),
    headings: doc.querySelectorAll('h1, h2, h3').length,
  };
};
