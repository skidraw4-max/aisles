import { prisma } from '@/lib/prisma';
import { createAdminClient, hasServiceRoleKey } from '@/lib/supabase/admin';

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    readonly status: number = 500
  ) {
    super(message);
    this.name = 'AccountDeletionError';
  }
}

/** Prisma 사용자 행·작성 게시글 삭제 후 Supabase Auth 사용자 제거 */
export async function deleteUserAccount(userId: string): Promise<void> {
  if (!hasServiceRoleKey()) {
    throw new AccountDeletionError(
      '탈퇴 처리를 위한 서버 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.',
      503
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!existing) {
    throw new AccountDeletionError('이미 탈퇴했거나 존재하지 않는 계정입니다.', 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.post.deleteMany({ where: { authorId: userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error('[delete-account] supabase deleteUser', error.message);
    throw new AccountDeletionError('계정 탈퇴 처리 중 오류가 발생했습니다. 고객센터로 문의해 주세요.', 500);
  }
}
