/** Display-only helpers for the /jury/reviews table. No data or judging logic. */
const KST = 'Asia/Seoul';

function kstParts(value: string): Record<string, string> | null {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 'MM-DD HH:mm' in KST; falls back to the raw value when it is not a date. */
export function formatKstShort(value: string | null | undefined): string {
  if (!value) return '—';
  const p = kstParts(value);
  return p ? `${p.month}-${p.day} ${p.hour}:${p.minute}` : value;
}

/** 'YYYY-MM-DD HH:mm:ss KST'; falls back to the raw value when it is not a date. */
export function formatKstFull(value: string | null | undefined): string {
  if (!value) return '—';
  const p = kstParts(value);
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} KST` : value;
}

/** First 8 characters followed by an ellipsis. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
