const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 쿼리스트링 `exclude` — 콤마 구분 UUID, 최대 48개 */
export function parseFeedExcludeIds(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.filter((id) => UUID_RE.test(id)).slice(0, 48);
}
