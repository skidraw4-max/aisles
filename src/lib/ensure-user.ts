import type { User as SupabaseUser } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { sanitizeUsername } from '@/lib/username';

/** 게시글 등 작성 전 Prisma `User` 행이 있도록 보장 */
export async function ensurePrismaUser(user: SupabaseUser) {
  if (!user.email) return;
  const emailLocal = user.email.split('@')[0] ?? 'user';
  const metaName = user.user_metadata?.username as string | undefined;
  let username = sanitizeUsername(metaName ?? '', emailLocal);
  const taken = await prisma.user.findFirst({
    where: { username, NOT: { id: user.id } },
    select: { id: true },
  });
  if (taken) {
    username = sanitizeUsername(`${metaName ?? emailLocal}_${user.id.slice(0, 8)}`, user.id.slice(0, 8));
  }
  await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      username,
      role: 'USER',
    },
    update: { email: user.email },
  });
}
