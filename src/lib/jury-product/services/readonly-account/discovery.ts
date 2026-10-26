/**
 * I-049: menu auto-discovery for READ_ONLY_ACCOUNT observations (pure helpers, no I/O).
 * After login the executor collects same-origin links (nav/menu/header/sidebar first, then any <a href>) and visits
 * them with GET navigation only. Links that look destructive or session-ending are skipped; buttons and forms are
 * never used. Only path + counts are kept; labels are sanitized so no PII-looking text is stored.
 */
export type DiscoveredLink = { href: string; text: string; download?: boolean; nav?: boolean };
export type PageStats = { listItems: number; cards: number; tableRows: number; headings: number };
export type DiscoveryOptions = { maxPages: number; maxDepth: number; budgetMs: number; perPageLinks: number };

export const DEFAULT_DISCOVERY: DiscoveryOptions = { maxPages: 20, maxDepth: 2, budgetMs: 200_000, perPageLinks: 60 };

const UNSAFE_PATH =
  /(log-?out|sign-?out|log-?off|delete|remove|destroy|withdraw|unsubscribe|deactivate|leave|cancel|refund|reset|revoke)|(^|[/_.-])(pay|payment|payments|checkout|billing|purchase|buy|order\/new|subscribe)([/_.-]|$)/i;
const UNSAFE_TEXT = /(로그아웃|탈퇴|삭제|제거|결제|구매|해지|취소|환불|초기화|logout|log out|sign out|signout|delete|remove|withdraw|checkout|pay now|unsubscribe)/i;
const FILE_EXT = /\.(pdf|zip|gz|tar|rar|7z|csv|tsv|xlsx?|docx?|pptx?|hwp|png|jpe?g|gif|webp|svg|ico|mp4|mov|mp3|wav|exe|dmg|apk|msi|json|xml|txt)$/i;

export type LinkVerdict = { ok: true; key: string; path: string } | { ok: false; reason: 'SCHEME' | 'ORIGIN' | 'UNSAFE' | 'FILE' | 'LOGIN' };

/** origin + pathname without query/hash; trailing slash removed except for the root. */
export function normalizeLinkKey(u: URL): string {
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') || '/' : u.pathname;
  return `${u.origin}${path}`;
}

export function classifyLink(link: DiscoveredLink, base: string, allowedOrigins: readonly string[], loginPath?: string): LinkVerdict {
  const raw = link.href.trim();
  if (/^(mailto|tel|sms|javascript|data|blob|file|ftp):/i.test(raw)) return { ok: false, reason: 'SCHEME' };
  let u: URL;
  try {
    u = new URL(raw, base);
  } catch {
    return { ok: false, reason: 'SCHEME' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'SCHEME' };
  if (!allowedOrigins.includes(u.origin)) return { ok: false, reason: 'ORIGIN' };
  if (link.download || FILE_EXT.test(u.pathname)) return { ok: false, reason: 'FILE' };
  let decoded = u.pathname;
  try {
    decoded = decodeURIComponent(u.pathname);
  } catch {
    /* keep raw */
  }
  if (UNSAFE_PATH.test(decoded) || UNSAFE_TEXT.test(decoded) || UNSAFE_TEXT.test(link.text)) return { ok: false, reason: 'UNSAFE' };
  const key = normalizeLinkKey(u);
  const path = key.slice(u.origin.length);
  if (loginPath && path === (loginPath.length > 1 ? loginPath.replace(/\/+$/, '') : loginPath)) return { ok: false, reason: 'LOGIN' };
  return { ok: true, key, path };
}

/** Link text as a label, dropped (→ path) when it looks like PII: emails, long digit runs, "님" greetings. */
export function sanitizeLabel(text: string, fallback: string): string {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!t || /@|\d{4,}|님\b|님$/.test(t)) return fallback.slice(0, 64);
  return t;
}

/** Orders nav/menu links first, dedupes by key, keeps only safe same-origin links. */
export function pickLinks(
  links: readonly DiscoveredLink[],
  base: string,
  allowedOrigins: readonly string[],
  opts: { loginPath?: string; limit: number },
): { key: string; path: string; label: string }[] {
  const ordered = [...links.filter((l) => l.nav), ...links.filter((l) => !l.nav)];
  const seen = new Set<string>();
  const out: { key: string; path: string; label: string }[] = [];
  for (const link of ordered) {
    const v = classifyLink(link, base, allowedOrigins, opts.loginPath);
    if (!v.ok || seen.has(v.key)) continue;
    seen.add(v.key);
    out.push({ key: v.key, path: v.path, label: sanitizeLabel(link.text, v.path) });
    if (out.length >= opts.limit) break;
  }
  return out;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
export function normalizeStats(s: unknown): PageStats | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const r = s as Record<string, unknown>;
  return { listItems: n(r.listItems), cards: n(r.cards), tableRows: n(r.tableRows), headings: n(r.headings) };
}
