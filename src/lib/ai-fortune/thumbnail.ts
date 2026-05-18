/** AI FORTUNE 대표 썸네일 — `AI_FORTUNE_THUMBNAIL_URL` 로 교체 가능 */
const DEFAULT_AI_FORTUNE_THUMBNAIL =
  'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1200&q=80&auto=format&fit=crop';

export function resolveAiFortuneThumbnailUrl(): string {
  const fromEnv = process.env.AI_FORTUNE_THUMBNAIL_URL?.trim();
  if (fromEnv && (fromEnv.startsWith('https://') || fromEnv.startsWith('http://'))) {
    return fromEnv;
  }
  return DEFAULT_AI_FORTUNE_THUMBNAIL;
}
