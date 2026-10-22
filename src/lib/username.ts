/** Prisma `User.username` / 표시 닉네임용 — 특수문자 정리 및 길이 제한 */
export function sanitizeUsername(raw: string, fallback: string) {
  const base = (raw?.trim() || fallback)
    .replace(/[^a-zA-Z0-9_가-힣-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
  return base || `user_${fallback.slice(0, 8)}`;
}
