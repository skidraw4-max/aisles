const MAX_TAGS = 24;
const MAX_TAG_LEN = 40;

/** DB 저장·API용: 공백·쉼표 분리, # 제거, 중복 제거, 길이 제한 */
export function normalizePostTagsInput(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];

  const pushUnique = (out: string[], t: string) => {
    let s = t.trim();
    if (s.startsWith('#')) s = s.slice(1).trim();
    if (!s) return;
    if (s.length > MAX_TAG_LEN) s = s.slice(0, MAX_TAG_LEN);
    if (!out.includes(s)) out.push(s);
  };

  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') continue;
      pushUnique(out, item);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  if (typeof raw === 'string') {
    const parts = raw.split(/[,，\s]+/u).filter(Boolean);
    const out: string[] = [];
    for (const p of parts) {
      pushUnique(out, p);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  return [];
}
