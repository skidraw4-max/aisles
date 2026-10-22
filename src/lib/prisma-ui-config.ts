import { Prisma } from '@prisma/client';

/** `UiConfig` 테이블이 아직 없을 때(P2021) */
export function isPrismaUiConfigTableMissing(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2021') {
    return false;
  }
  const meta = e.meta as { table?: string; modelName?: string } | undefined;
  const table = meta?.table ?? '';
  const model = meta?.modelName ?? '';
  return table.includes('UiConfig') || model === 'UiConfig' || e.message.includes('UiConfig');
}
