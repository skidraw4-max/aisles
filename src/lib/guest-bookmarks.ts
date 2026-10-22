export const GUEST_BOOKMARKS_STORAGE_KEY = 'aisle:guest-bookmarks';

function readIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GUEST_BOOKMARKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUEST_BOOKMARKS_STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore quota / private mode */
  }
}

export function isGuestBookmarked(postId: string): boolean {
  return readIds().includes(postId);
}

export function addGuestBookmark(postId: string): void {
  const ids = readIds();
  if (!ids.includes(postId)) writeIds([...ids, postId]);
}

export function removeGuestBookmark(postId: string): void {
  writeIds(readIds().filter((id) => id !== postId));
}

export function getGuestBookmarkIds(): string[] {
  return readIds();
}

export function clearGuestBookmarks(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GUEST_BOOKMARKS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
