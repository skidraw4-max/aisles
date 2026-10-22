/** 썸네일 URL이 비어 있지 않은지 (서버·클라이언트 공용) */
export function hasValidPostThumbnail(thumbnail: string | null | undefined): boolean {
  return typeof thumbnail === 'string' && thumbnail.trim().length > 0;
}
