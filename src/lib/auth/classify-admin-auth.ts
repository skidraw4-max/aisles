import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { classifyAdminAuthCore, type AdminAuthClass } from '@/lib/auth/classify-admin-auth-core';

/**
 * Diagnostics-only wrapper: wires the pure classifier to the existing Supabase server
 * client and Prisma. Does not change requireAdminAction or its callers.
 * Importing this module pulls Prisma (DB/TLS guards run at import time).
 */
export function classifyAdminAuth(): Promise<AdminAuthClass> {
  return classifyAdminAuthCore({
    getUser: async () => {
      const supabase = await createClient();
      return supabase.auth.getUser();
    },
    findRole: async (userId) => {
      const row = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      return row?.role ?? null;
    },
  });
}
