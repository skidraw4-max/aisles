import { NextResponse, type NextRequest } from 'next/server';
import { sanitizeUsername } from '@/lib/username';

/**
 * POST /api/auth/sync-profile handler factory (behavior of the original route, with
 * dependencies injected for tests). Upserts the Prisma User by Supabase Auth id only.
 * Never merges, re-keys, or upserts by email. An email unique conflict (an existing row
 * with the same email under a different id) is reported as 409 ACCOUNT_EMAIL_CONFLICT.
 */

type AuthUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };

export type SyncProfileDeps = {
  env: { readonly [key: string]: string | undefined };
  getUser: (
    url: string,
    anon: string,
    token: string,
  ) => Promise<{ data: { user: AuthUser | null }; error: unknown }>;
  db: {
    findUsernameOwner: (username: string, excludeId: string) => Promise<{ id: string } | null>;
    upsertUser: (args: {
      where: { id: string };
      create: { id: string; email: string; username: string; role: 'USER' };
      update: { email: string; username?: string };
    }) => Promise<unknown>;
    findUsername: (id: string) => Promise<{ username: string } | null>;
  };
  /** Fixed-code logger; defaults to console.error. */
  log?: (event: string, detail: { stage: SyncStage; prismaCode?: string }) => void;
};

export type SyncStage = 'upsert' | 'readback';

const PRISMA_CODE = /^P\d{4}$/;
const EMAIL_CONSTRAINT = 'User_email_key';

/** Prisma error code, only when it is a well-formed P#### string. */
export function safePrismaCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PRISMA_CODE.test(code) ? code : undefined;
}

function namesEmail(target: unknown): boolean {
  if (Array.isArray(target)) return target.length === 1 && target[0] === 'email';
  return target === EMAIL_CONSTRAINT;
}

/**
 * True only for P2002 whose violated unique target is exactly the User.email field.
 * Prisma 7.6 + @prisma/adapter-pg: meta.driverAdapterError.cause =
 *   { kind: 'UniqueConstraintViolation', constraint: { fields: ['email'] } | { index: '...' } }
 * Legacy engines: meta.target = ['email'] | 'User_email_key'. Anything else => false.
 */
export function isEmailUniqueConflict(e: unknown): boolean {
  if (safePrismaCode(e) !== 'P2002') return false;
  const meta = (e as { meta?: unknown }).meta as
    | { target?: unknown; driverAdapterError?: { cause?: { kind?: unknown; constraint?: unknown } } }
    | undefined;
  if (!meta || typeof meta !== 'object') return false;
  const cause = meta.driverAdapterError?.cause;
  if (cause && typeof cause === 'object') {
    if (cause.kind !== 'UniqueConstraintViolation') return false;
    const c = cause.constraint as { fields?: unknown; index?: unknown } | undefined;
    if (!c || typeof c !== 'object') return false;
    if ('fields' in c) return namesEmail(c.fields);
    if ('index' in c) return namesEmail(c.index);
    return false;
  }
  return namesEmail(meta.target);
}

export function createSyncProfileHandler(deps: SyncProfileDeps) {
  const log =
    deps.log ?? ((event: string, detail: { stage: SyncStage; prismaCode?: string }) => console.error(event, detail));

  return async function POST(req: NextRequest | Request): Promise<Response> {
    const url = deps.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = deps.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
    }

    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 401 });
    }

    const {
      data: { user },
      error,
    } = await deps.getUser(url, anon, token);

    if (error || !user?.email) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }
    const metaName = user.user_metadata?.username as string | undefined;
    const emailLocal = user.email.split('@')[0] ?? 'user';
    let username = sanitizeUsername(metaName ?? '', emailLocal);

    const taken = await deps.db.findUsernameOwner(username, user.id);
    if (taken) {
      username = sanitizeUsername(`${metaName ?? emailLocal}_${user.id.slice(0, 8)}`, user.id.slice(0, 8));
    }

    let stage: SyncStage = 'upsert';
    try {
      await deps.db.upsertUser({
        where: { id: user.id },
        create: {
          id: user.id,
          email: user.email,
          username,
          role: 'USER',
        },
        update: {
          email: user.email,
          ...(metaName?.trim() ? { username } : {}),
        },
      });
      stage = 'readback';
      const row = await deps.db.findUsername(user.id);
      return NextResponse.json({ ok: true, username: row?.username ?? username });
    } catch (e) {
      const prismaCode = safePrismaCode(e);
      log('[sync-profile] SYNC_FAILED', prismaCode ? { stage, prismaCode } : { stage });
      if (stage === 'upsert' && isEmailUniqueConflict(e)) {
        return NextResponse.json({ code: 'ACCOUNT_EMAIL_CONFLICT' }, { status: 409 });
      }
      return NextResponse.json({ error: 'Profile sync failed' }, { status: 500 });
    }
  };
}
