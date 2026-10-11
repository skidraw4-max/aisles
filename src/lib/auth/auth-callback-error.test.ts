import assert from 'node:assert/strict';
import test from 'node:test';
import { supabaseAuthCallbackGet } from '../supabase-auth-callback';
import {
  AUTH_CALLBACK_EMAIL_QUERY,
  AUTH_CALLBACK_SIGNIN_QUERY,
  authCallbackFailureQuery,
  authCallbackLogLine,
  isEmailLinkFlow,
  safeAuthErrorCode,
  withEmailFlowMarker,
} from './auth-callback-error';
import {
  ACCOUNT_EMAIL_CONFLICT_MESSAGE,
  AUTH_CALLBACK_EMAIL_ERROR,
  AUTH_CALLBACK_SIGNIN_ERROR,
  authCallbackFailureText,
  juryLoginErrorNotice,
} from './account-email-conflict';

const ORIGIN = 'https://aisles-git-preview-skidraw4-maxs-projects.vercel.app';
const CODE = 'SENTINELCODE1234567890';
const HASH = 'SENTINELHASH1234567890';
const TOKEN = 'SENTINELACCESSTOKEN';
const DESC = 'SENTINEL description person@example.invalid';
const SECRETS = [CODE, HASH, TOKEN, DESC, 'SENTINEL', '@example'];

type Fake = {
  exchange?: { data: { session: { access_token: string } | null }; error: { message: string; code?: string } | null };
  otp?: { data: { session: { access_token: string } | null }; error: { message: string; code?: string } | null };
  user?: { id: string } | null;
  session?: { access_token: string } | null;
};

function fakeClient(f: Fake) {
  const client = {
    auth: {
      exchangeCodeForSession: async () => f.exchange,
      verifyOtp: async () => f.otp,
      getUser: async () => ({ data: { user: f.user ?? null }, error: f.user ? null : { message: 'no user' } }),
      getSession: async () => ({ data: { session: f.session ?? null } }),
    },
  };
  return (async () => client) as never;
}

async function run(query: string, f: Fake, opts: { fixed?: boolean; syncStatus?: number } = {}) {
  const logs: string[] = [];
  const origError = console.error;
  const origWarn = console.warn;
  const origFetch = globalThis.fetch;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(opts.syncStatus === 409 ? { code: 'ACCOUNT_EMAIL_CONFLICT' } : { ok: true }), {
      status: opts.syncStatus ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  try {
    const res = await supabaseAuthCallbackGet(
      new Request(`${ORIGIN}/auth/callback${query}`),
      opts.fixed ? { afterSuccess: 'fixed', path: '/auth/reset-password' } : { afterSuccess: 'fromNextQueryOrHome' },
      { createClient: fakeClient(f) },
    );
    const location = res.headers.get('location') ?? '';
    return { status: res.status, location, logs: logs.join('\n') };
  } finally {
    console.error = origError;
    console.warn = origWarn;
    globalThis.fetch = origFetch;
  }
}

function assertNoSecrets(r: { location: string; logs: string }) {
  for (const s of SECRETS) {
    assert.ok(!r.location.includes(s), `location leaks ${s}`);
    assert.ok(!r.logs.includes(s), `logs leak ${s}`);
  }
  for (const p of ['code=', 'token_hash=', 'access_token', 'error_description']) assert.ok(!r.location.includes(p), p);
}

const noSession = { data: { session: null } };

test('1. OAuth provider error (error/error_code, no code) -> oauth_callback, safe log only', async () => {
  const r = await run(`?error=server_error&error_code=unexpected_failure&error_description=${encodeURIComponent(DESC)}&next=%2Fjury`, {});
  assert.equal(r.location, `${ORIGIN}/login?error=${AUTH_CALLBACK_SIGNIN_QUERY}`);
  assert.match(r.logs, /kind=provider_error error=server_error error_code=unexpected_failure/);
  assertNoSecrets(r);
});

test('2. hostile provider error codes are replaced in logs', async () => {
  const r = await run(`?error=${encodeURIComponent('<script>SENTINEL')}&error_code=${encodeURIComponent('Bad-Code person@example.invalid')}`, {});
  assert.equal(r.location, `${ORIGIN}/login?error=oauth_callback`);
  assert.match(r.logs, /kind=provider_error error=unrecognized error_code=unrecognized/);
  assertNoSecrets(r);
});

test('3. code exchange failure -> oauth_callback; message text and code never logged', async () => {
  const r = await run(`?code=${CODE}`, { exchange: { ...noSession, error: { message: `invalid ${DESC}`, code: 'bad_code_verifier' } } });
  assert.equal(r.location, `${ORIGIN}/login?error=oauth_callback`);
  assert.match(r.logs, /kind=code_exchange_failed error_code=bad_code_verifier/);
  assertNoSecrets(r);
});

test('4. code exchange failure with an existing session keeps the recovery redirect', async () => {
  const r = await run(`?code=${CODE}&next=%2Fjury`, {
    exchange: { ...noSession, error: { message: 'used', code: 'flow_state_not_found' } },
    user: { id: 'u1' },
    session: { access_token: TOKEN },
  });
  assert.equal(r.location, `${ORIGIN}/jury`);
  assertNoSecrets(r);
});

test('5. code exchange without a session -> oauth_callback', async () => {
  const r = await run(`?code=${CODE}`, { exchange: { ...noSession, error: null } });
  assert.equal(r.location, `${ORIGIN}/login?error=oauth_callback`);
  assert.match(r.logs, /kind=code_no_session/);
  assertNoSecrets(r);
});

test('6. no code, no token_hash, no error -> oauth_callback (missing_params)', async () => {
  const r = await run('?next=%2Fjury', {});
  assert.equal(r.location, `${ORIGIN}/login?error=oauth_callback`);
  assert.match(r.logs, /kind=missing_params/);
  assertNoSecrets(r);
});

test('7. email link (verifyOtp) failure keeps auth_callback (email link expired notice)', async () => {
  const r = await run(`?token_hash=${HASH}&type=signup`, { otp: { ...noSession, error: { message: DESC, code: 'otp_expired' } } });
  assert.equal(r.location, `${ORIGIN}/login?error=${AUTH_CALLBACK_EMAIL_QUERY}`);
  assert.match(r.logs, /kind=otp_failed error_code=otp_expired/);
  assertNoSecrets(r);
  const n = await run(`?token_hash=${HASH}&type=signup`, { otp: { ...noSession, error: null } });
  assert.equal(n.location, `${ORIGIN}/login?error=auth_callback`);
});

test('8. fixed (password reset) flow keeps auth_callback for every failure', async () => {
  for (const q of [`?code=${CODE}`, '?error=server_error', '']) {
    const r = await run(q, { exchange: { ...noSession, error: { message: 'x' } } }, { fixed: true });
    assert.equal(r.location, `${ORIGIN}/login?error=auth_callback`, q);
    assertNoSecrets(r);
  }
});

test('9. account_email_conflict and success are unchanged; tokens never in URL/log', async () => {
  const c = await run(`?code=${CODE}&next=%2Fjury`, { exchange: { data: { session: { access_token: TOKEN } }, error: null } }, { syncStatus: 409 });
  assert.equal(c.location, `${ORIGIN}/login?error=account_email_conflict`);
  assertNoSecrets(c);
  const ok = await run(`?code=${CODE}&next=%2Fjury`, { exchange: { data: { session: { access_token: TOKEN } }, error: null } });
  assert.equal(ok.location, `${ORIGIN}/jury`);
  assertNoSecrets(ok);
  const evil = await run(`?code=${CODE}&next=%2F%2Fevil.example`, { exchange: { data: { session: { access_token: TOKEN } }, error: null } });
  assert.equal(evil.location, `${ORIGIN}/`);
});

test('10. classification helpers and message priority', () => {
  assert.equal(authCallbackFailureQuery('otp_failed'), 'auth_callback');
  assert.equal(authCallbackFailureQuery('otp_no_session'), 'auth_callback');
  for (const k of ['provider_error', 'code_exchange_failed', 'code_no_session', 'missing_params'] as const) {
    assert.equal(authCallbackFailureQuery(k), 'oauth_callback');
    assert.equal(authCallbackFailureQuery(k, true), 'auth_callback');
  }
  assert.equal(safeAuthErrorCode('invalid_client'), 'invalid_client');
  assert.equal(safeAuthErrorCode('a'.repeat(65)), 'unrecognized');
  assert.equal(safeAuthErrorCode(''), null);
  assert.equal(safeAuthErrorCode(undefined), null);
  assert.equal(authCallbackLogLine('missing_params'), 'kind=missing_params');
  assert.equal(authCallbackFailureText('auth_callback'), AUTH_CALLBACK_EMAIL_ERROR);
  assert.equal(authCallbackFailureText('oauth_callback'), AUTH_CALLBACK_SIGNIN_ERROR);
  for (const e of [null, '', 'other', 'OAUTH_CALLBACK', 'account_email_conflict']) assert.equal(authCallbackFailureText(e), null);
  assert.equal(juryLoginErrorNotice('account_email_conflict'), ACCOUNT_EMAIL_CONFLICT_MESSAGE);
  assert.equal(juryLoginErrorNotice('auth_callback'), AUTH_CALLBACK_EMAIL_ERROR);
  assert.equal(juryLoginErrorNotice('oauth_callback'), AUTH_CALLBACK_SIGNIN_ERROR);
  assert.notEqual(AUTH_CALLBACK_SIGNIN_ERROR, AUTH_CALLBACK_EMAIL_ERROR);
  assert.ok(/[\uac00-\ud7a3]/.test(AUTH_CALLBACK_SIGNIN_ERROR));
  assert.ok(!/이메일|만료|Google|secret|client/i.test(AUTH_CALLBACK_SIGNIN_ERROR), 'generic: no asserted cause');
});

test('flow=email marker: exact value only selects the email message for every code-path failure', async () => {
  const cases: Array<[string, Fake]> = [
    ['?error=server_error&error_code=unexpected_failure&error_description=' + encodeURIComponent(DESC), {}],
    ['?code=' + CODE, { exchange: { data: { session: null }, error: { message: DESC, code: 'bad_code_verifier' } } }],
    ['?code=' + CODE, { exchange: { ...noSession, error: null } }],
    ['', {}],
  ];
  for (const [q, f] of cases) {
    const sep = q ? '&' : '?';
    const email = await run(q + sep + 'flow=email&next=%2Fjury', f);
    assert.equal(email.location, ORIGIN + '/login?error=' + AUTH_CALLBACK_EMAIL_QUERY);
    assert.ok(email.logs.includes('email_flow=true'));
    assertNoSecrets(email);
    for (const flow of ['', sep + 'flow=EMAIL', sep + 'flow=email2', sep + 'flow=oauth', sep + 'flow=']) {
      const other = await run(q + flow, f);
      assert.equal(other.location, ORIGIN + '/login?error=' + AUTH_CALLBACK_SIGNIN_QUERY, q + flow);
      assert.ok(!other.logs.includes('email_flow'));
      assertNoSecrets(other);
    }
  }
});

test('flow=email marker does not change success, next sanitization, conflict priority, or reset path', async () => {
  const ok = { exchange: { data: { session: { access_token: TOKEN } }, error: null } };
  const s1 = await run('?code=' + CODE + '&flow=email&next=%2Fjury%2Forganization%2Fcreate', ok);
  assert.equal(s1.location, ORIGIN + '/jury/organization/create');
  assert.ok(!s1.location.includes('flow'));
  const s2 = await run('?code=' + CODE + '&flow=email&next=%2F%2Fevil.example', ok);
  assert.equal(s2.location, ORIGIN + '/');
  const c = await run('?code=' + CODE + '&flow=email', ok, { syncStatus: 409 });
  assert.equal(c.location, ORIGIN + '/login?error=account_email_conflict');
  const r1 = await run('?code=' + CODE + '&flow=email', ok, { fixed: true });
  assert.equal(r1.location, ORIGIN + '/auth/reset-password');
  const r2 = await run('?code=' + CODE, { exchange: { ...noSession, error: null } }, { fixed: true });
  assert.equal(r2.location, ORIGIN + '/login?error=' + AUTH_CALLBACK_EMAIL_QUERY);
  for (const r of [s1, s2, c, r1, r2]) assertNoSecrets(r);
});

test('email flow marker helpers', () => {
  assert.equal(isEmailLinkFlow('email'), true);
  for (const v of [null, undefined, '', 'Email', 'email ', 'oauth']) assert.equal(isEmailLinkFlow(v), false);
  assert.equal(withEmailFlowMarker('https://h.example/auth/callback'), 'https://h.example/auth/callback?flow=email');
  assert.equal(
    withEmailFlowMarker('https://h.example/auth/callback?next=%2Fjury&flow=x'),
    'https://h.example/auth/callback?next=%2Fjury&flow=email',
  );
});
