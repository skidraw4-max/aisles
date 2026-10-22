import { Prisma } from '@prisma/client';

/** `Notice` 테이블이 아직 없을 때(P2021) — migrate/db push 전 로컬 개발용 */
export function isPrismaNoticeTableMissing(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2021') {
    return false;
  }
  const meta = e.meta as { table?: string; modelName?: string } | undefined;
  const table = meta?.table ?? '';
  const model = meta?.modelName ?? '';
  return table.includes('Notice') || model === 'Notice' || e.message.includes('Notice');
}
