/** Supabase 세션 토큰으로 Prisma `User` 행을 upsert (회원가입·로그인·세션 복구 공통) */
export async function syncPrismaUserWithAuth(accessToken: string) {
  const res = await fetch('/api/auth/sync-profile', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || '프로필 동기화에 실패했습니다.');
  }
  return res.json() as Promise<{ ok?: boolean; username?: string | null }>;
}
