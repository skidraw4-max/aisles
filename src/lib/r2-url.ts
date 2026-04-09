/** Supabase Storage 공개 객체 URL 접두사 (버킷은 업로드와 동일하게 맞춤) */
export function getSupabaseStoragePublicPrefix(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  const base = raw.replace(/\/$/, '');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'uploads';
  return `${base}/storage/v1/object/public/${bucket}/`;
}

/** R2 퍼블릭 베이스 URL */
export function getR2PublicBase(): string | null {
  const raw =
    process.env.R2_PUBLIC_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.trim();
  const b = raw?.replace(/\/$/, '');
  return b || null;
}

/**
 * 게시글·프로필 미디어로 허용하는 URL (임의 URL 주입 방지).
 * Cloudflare R2 퍼블릭 도메인 또는 동일 프로젝트 Supabase Storage 공개 버킷.
 */
export function isTrustedMediaUrl(url: string): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  const r2Base = getR2PublicBase();
  if (r2Base && (url === r2Base || url.startsWith(`${r2Base}/`))) {
    return true;
  }

  const supPrefix = getSupabaseStoragePublicPrefix();
  if (supPrefix && url.startsWith(supPrefix)) {
    return true;
  }

  return false;
}

/** @deprecated `isTrustedMediaUrl` 사용 */
export function isTrustedR2Url(url: string): boolean {
  return isTrustedMediaUrl(url);
}
