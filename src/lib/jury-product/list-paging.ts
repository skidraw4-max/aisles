/** RM-15 (I-021): server-side list filter/search/paging. Pure; inputs come from URL search params. */
export const LIST_PAGE_SIZE = 20;

export type ListQuery = { q: string; filter: string; page: number };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function readListQuery(params: Record<string, string | string[] | undefined>): ListQuery {
  const page = Number.parseInt(one(params.page), 10);
  return {
    q: one(params.q).trim().slice(0, 100),
    filter: one(params.filter).trim().slice(0, 64),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function pageList<T>(
  items: readonly T[],
  query: ListQuery,
  opts: { text: (item: T) => string; key?: (item: T) => string; pageSize?: number },
): { items: T[]; total: number; page: number; pages: number; filterOptions: string[] } {
  const size = opts.pageSize ?? LIST_PAGE_SIZE;
  const filterOptions = opts.key ? [...new Set(items.map(opts.key))].sort() : [];
  const needle = query.q.toLowerCase();
  const matched = items.filter((item) =>
    (!query.filter || !opts.key || opts.key(item) === query.filter)
    && (!needle || opts.text(item).toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const page = Math.min(query.page, pages);
  return { items: matched.slice((page - 1) * size, page * size), total: matched.length, page, pages, filterOptions };
}

/** Appends q/filter/page to an already-resolved Jury href (juryHref drops non-ASCII query values). */
export function listHref(base: string, query: ListQuery, page: number): string {
  const p = new URLSearchParams();
  if (query.q) p.set('q', query.q);
  if (query.filter) p.set('filter', query.filter);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `${base}${base.includes('?') ? '&' : '?'}${s}` : base;
}
