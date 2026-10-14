import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/prisma';
import { createSyncProfileHandler } from '@/lib/auth/sync-profile-handler';

export async function POST(req: NextRequest) {
  return createSyncProfileHandler({
    env: process.env,
    getUser: (url, anon, token) => createClient(url, anon).auth.getUser(token),
    db: {
      findUsernameOwner: (username, excludeId) =>
        prisma.user.findFirst({ where: { username, NOT: { id: excludeId } }, select: { id: true } }),
      upsertUser: (args) => prisma.user.upsert(args),
      findUsername: (id) => prisma.user.findUnique({ where: { id }, select: { username: true } }),
    },
  })(req);
}
