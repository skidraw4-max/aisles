import { NextRequest, NextResponse } from 'next/server';
import { getUserFromBearer } from '@/lib/auth-bearer';
import { AccountDeletionError, deleteUserAccount } from '@/lib/delete-account';

/** 로그인 사용자 본인 계정 탈퇴 */
export async function DELETE(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if (!auth.ok) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  try {
    await deleteUserAccount(auth.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AccountDeletionError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error('[account/withdraw]', e);
    return NextResponse.json({ error: '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 });
  }
}
