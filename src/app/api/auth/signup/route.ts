import { createAdminClient, hasServiceRoleKey } from '@/lib/supabase/admin';
import { sanitizeUsername } from '@/lib/username';
import { NextResponse } from 'next/server';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

const SERVICE_ROLE_HINT =
  '배포 환경(Vercel 등)에 SUPABASE_SERVICE_ROLE_KEY 를 넣어 주세요. Supabase Dashboard → Settings → API 의 service_role 키입니다. 저장 후 재배포가 필요할 수 있습니다.';

/**
 * 이메일 인증을 끈 프로젝트용: 클라이언트 `signUp`은 확인 메일 발송으로
 * 내장 SMTP rate limit 에 걸릴 수 있어, Admin `createUser` + `email_confirm: true` 로만 생성(메일 없음).
 * 이후 클라이언트에서 `signInWithPassword` 로 세션 확보.
 */
export async function POST(request: Request) {
  if (!hasServiceRoleKey()) {
    return NextResponse.json(
      { error: `서버에 service_role 키가 없습니다. ${SERVICE_ROLE_HINT}`, code: 'SERVICE_ROLE_MISSING' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const o = body as { email?: unknown; password?: unknown; username?: unknown };
  const email = typeof o.email === 'string' ? o.email.trim() : '';
  const password = typeof o.password === 'string' ? o.password : '';
  const usernameRaw = typeof o.username === 'string' ? o.username.trim() : '';

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: '유효한 이메일을 입력해 주세요.' }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ error: `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.` }, { status: 400 });
  }
  if (!usernameRaw) {
    return NextResponse.json({ error: '닉네임을 입력해 주세요.' }, { status: 400 });
  }

  const emailLocal = email.split('@')[0] ?? 'user';
  const usernameSanitized = sanitizeUsername(usernameRaw, emailLocal);
  if (usernameSanitized.length < 2) {
    return NextResponse.json({ error: '사용할 수 없는 닉네임입니다.' }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: usernameRaw },
    });

    if (error) {
      const msg = error.message || '';
      if (/already been registered|already exists|already registered|duplicate/i.test(msg)) {
        return NextResponse.json({ error: '이미 가입된 이메일입니다.' }, { status: 409 });
      }
      console.error('[api/auth/signup]', msg);
      return NextResponse.json(
        { error: msg || '회원가입에 실패했습니다.' },
        { status: 400 },
      );
    }

    if (!data.user) {
      return NextResponse.json({ error: '회원가입에 실패했습니다.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[api/auth/signup]', e);
    return NextResponse.json({ error: '회원가입에 실패했습니다.' }, { status: 500 });
  }
}
