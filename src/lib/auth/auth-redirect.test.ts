import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isAllowedAuthOrigin, isSafeRelativePath, requestUrlOrigin, resolveAuthCallbackBase, resolveEmailLinkBase, safeRelativePath } from './auth-redirect';
import { buildPasswordRecoveryPageUrlWithToken, getPasswordRecoveryRedirectToForServer } from '../site-url';
import {
  ACCOUNT_EMAIL_CONFLICT_MESSAGE,
  AccountEmailConflictError,
  AUTH_CALLBACK_EMAIL_ERROR,
  accountEmailConflictNotice,
  createProfileSyncGate,
  juryLoginErrorNotice,
  runProfileSync,
  syncProfileWithGate,
} from './account-email-conflict';
import { juryOAuthRedirect } from '../jury-product/jury-url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const src = (rel: string) => readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');
const PROD = 'https://www.aisleshub.com';
const JURY = 'https://jury.aisleshub.com';
const PREVIEW = 'https://aisles-git-preview-verify-c2-supa-d1a409-skidraw4-maxs-projects.vercel.app';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('1. Preview OAuth callback stays on the Preview origin (not Production)', () => {
  const base = resolveAuthCallbackBase({ publicSiteUrl: PROD, currentOrigin: PREVIEW });
  assert.equal(base, PREVIEW);
  const jury = juryOAuthRedirect(base, null);
  assert.equal(jury?.redirectTo, `${PREVIEW}/auth/callback?next=%2Fjury`);
  assert.ok(!jury!.redirectTo.includes('aisleshub.com'));
});

test('2. allowlisted origins are kept; everything else falls back to publicSiteUrl unchanged', () => {
  for (const o of [PROD, JURY, PREVIEW, 'https://aisles-n7dtpzjzm-skidraw4-maxs-projects.vercel.app', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://localhost']) {
    assert.equal(isAllowedAuthOrigin(o), true, o);
    assert.equal(resolveAuthCallbackBase({ publicSiteUrl: 'https://fallback.example', currentOrigin: o }), o);
  }
  const rejected = [
    null, undefined, '', 'not a url', 'https://aisleshub.com', 'http://www.aisleshub.com', 'https://www.aisleshub.com:8443',
    'https://www.aisleshub.com/', 'https://user:pw@www.aisleshub.com', 'https://evil.example', 'https://jury.aisleshub.com.evil.example',
    'https://aisles-x-other-team.vercel.app', 'https://a.b-skidraw4-maxs-projects.vercel.app', 'https://skidraw4-maxs-projects.vercel.app',
    'https://aisles-x-skidraw4-maxs-projects.vercel.app.evil.example', 'http://aisles-x-skidraw4-maxs-projects.vercel.app',
    'https://localhost:3000', 'http://localhost.evil.example', 'javascript:alert(1)',
  ];
  for (const o of rejected) {
    assert.equal(isAllowedAuthOrigin(o), false, String(o));
    assert.equal(resolveAuthCallbackBase({ publicSiteUrl: PROD, currentOrigin: o }), PROD, String(o));
  }
  assert.equal(juryOAuthRedirect(PROD, null)?.redirectTo, `${PROD}/auth/callback?next=%2Fjury`);
  assert.equal(juryOAuthRedirect(resolveAuthCallbackBase({ publicSiteUrl: PROD, currentOrigin: JURY }), null)?.redirectTo, `${JURY}/auth/callback?next=%2Fjury`);
  assert.ok(!src('src/lib/site-url.ts').includes('NEXT_PUBLIC_VERCEL_ENV'));
});

test('3. login failure -> fixed same-origin error page; conflict -> Korean notice', () => {
  const cb = src('src/lib/supabase-auth-callback.ts');
  assert.match(cb, /new URL\(`\/login\?error=\$\{authCallbackFailureQuery\(kind, options\.afterSuccess === 'fixed' \|\| emailFlow\)\}`, url\.origin\)/);
  assert.match(cb, /new URL\(`\/login\?error=\$\{ACCOUNT_EMAIL_CONFLICT_QUERY\}`, url\.origin\)/);
  const n = accountEmailConflictNotice('account_email_conflict');
  assert.equal(n?.text, ACCOUNT_EMAIL_CONFLICT_MESSAGE);
  assert.ok(/[\uac00-\ud7a3]/.test(n!.text));
  assert.equal(accountEmailConflictNotice('auth_callback'), null);
});

test('4. open redirects are blocked (callback next, login next, AuthModal next)', () => {
  const bad = ['//evil.example', '/\\evil.example', '/\\/evil.example', '\\\\evil.example', 'https://evil.example',
    'javascript:alert(1)', '/\t/evil.example', '/\n/evil.example', '', 'evil', null, undefined];
  for (const v of bad) {
    assert.equal(isSafeRelativePath(v), false, JSON.stringify(v));
    assert.equal(safeRelativePath(v, '/'), '/');
  }
  for (const v of ['/', '/jury', '/post/123?x=1', '/a/b#c']) {
    assert.equal(safeRelativePath(v, '/x'), v);
    assert.equal(new URL(v, PREVIEW).origin, PREVIEW);
  }
  const cb = src('src/lib/supabase-auth-callback.ts');
  assert.match(cb, /: safeRelativePath\(nextParam, '\/'\);/);
  assert.match(src('src/components/AuthModal.tsx'), /if \(isSafeRelativePath\(next\)\) \{/);
  assert.match(src('src/app/(root)/login/LoginClient.tsx'), /export function safeNextPath\(raw: string \| null\): string \{\n  return safeRelativePath\(raw, '\/'\);\n\}/);
});

test('5. password reset flow unchanged (fixed path, conflict check disabled, reset URLs use getPublicSiteUrl)', () => {
  assert.match(src('src/app/auth/reset-callback/route.ts'), /afterSuccess: 'fixed', path: '\/auth\/reset-password'/);
  const cb = src('src/lib/supabase-auth-callback.ts');
  assert.match(cb, /options\.afterSuccess === 'fixed'\n\s+\? options\.path/);
  assert.match(cb, /options\.afterSuccess === 'fixed' \? Promise\.resolve\(false\)/);
  const site = src('src/lib/site-url.ts');
  assert.match(site, /export function getPasswordRecoveryRedirectTo\(\): string \{[\s\S]*?const base = getPublicSiteUrl\(\)/);
  assert.match(site, /export function getPasswordRecoveryRedirectToForServer\(requestOrigin\?: string \| null\): string \{\n  const explicit = process\.env\.NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO\?\.trim\(\);\n  if \(explicit\) \{/);
  // OAuth starters switched; email-verification / signup links unchanged
  assert.match(src('src/components/jury/JuryLoginForm.tsx'), /juryOAuthRedirect\(getAuthCallbackSiteUrl\(\), returnQuery\)/);
  const signup = src('src/components/jury/JurySignupForm.tsx');
  assert.match(signup, /juryOAuthRedirect\(getAuthCallbackSiteUrl\(\), returnQuery\)/);
  assert.match(signup, /juryEmailVerificationDestination\(getPublicSiteUrl\(\), returnQuery\)/);
});

test('6. other status/codes are not treated as conflict by the gate', async () => {
  for (const res of [json(409, { code: 'OTHER' }), json(500, { code: 'ACCOUNT_EMAIL_CONFLICT' }), json(401, {}), new Response('x', { status: 409 })]) {
    const gate = createProfileSyncGate();
    assert.equal(await syncProfileWithGate(gate, 'u1', async () => res), 'failed');
    assert.equal(gate.shouldSync('u1'), true);
  }
});

test('7. transient errors never sign out and never block future sync', async () => {
  const gate = createProfileSyncGate();
  assert.equal(await syncProfileWithGate(gate, 'u1', async () => { throw new TypeError('network'); }), 'failed');
  assert.equal(gate.shouldSync('u1'), true);
  assert.equal(await runProfileSync(async () => { throw new Error('503'); }, 't', () => {}), 'proceed');
  for (const f of ['src/components/SessionProvider.tsx', 'src/lib/supabase-auth-callback.ts', 'src/lib/auth/account-email-conflict.ts', 'src/components/AuthModal.tsx', 'src/components/jury/JuryLoginForm.tsx', 'src/components/jury/JurySignupForm.tsx']) {
    assert.ok(!src(f).includes('signOut'), `${f} must not call signOut`);
  }
});

test('8. same conflict does not repeat sync-profile calls; user change / reset re-enables', async () => {
  const gate = createProfileSyncGate();
  let calls = 0;
  const conflict = async () => { calls++; return json(409, { code: 'ACCOUNT_EMAIL_CONFLICT' }); };
  assert.equal(await syncProfileWithGate(gate, 'u1', conflict), 'conflict');
  assert.equal(await syncProfileWithGate(gate, 'u1', conflict), 'skipped');
  assert.equal(await syncProfileWithGate(gate, 'u1', conflict), 'skipped');
  assert.equal(calls, 1);
  assert.equal(await syncProfileWithGate(gate, 'u2', async () => { calls++; return json(200, { ok: true }); }), 'synced');
  assert.equal(calls, 2);
  gate.reset();
  assert.equal(await syncProfileWithGate(gate, 'u1', conflict), 'conflict');
  assert.equal(calls, 3);
  const sp = src('src/components/SessionProvider.tsx');
  assert.match(sp, /const syncGate = useRef\(createProfileSyncGate\(\)\);/);
  assert.equal((sp.match(/syncGate\.current\.reset\(\);/g) ?? []).length, 2);
  assert.match(sp, /applyProfile\(session\.access_token, u\.id\)/);
  assert.match(sp, /applyProfile\(session\.access_token, session\.user\.id\)/);
  assert.ok(!sp.includes('ACCOUNT_EMAIL_CONFLICT'));
});

test('9. session/profile consistency: conflict error carries only the fixed message; UI stops before navigation', async () => {
  assert.equal(await runProfileSync(async () => { throw new AccountEmailConflictError(); }, 't', () => {}), 'conflict');
  assert.equal(new AccountEmailConflictError().message, ACCOUNT_EMAIL_CONFLICT_MESSAGE);
  assert.ok(!/@|Bearer|[0-9a-f]{8}-[0-9a-f]{4}/i.test(ACCOUNT_EMAIL_CONFLICT_MESSAGE));
});

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const NO_ENV = { NEXT_PUBLIC_SITE_URL: undefined, NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO: undefined };

test('10. reset URLs follow a validated request origin (jury/www/preview); otherwise canonical', () => {
  withEnv(NO_ENV, () => {
    assert.equal(getPasswordRecoveryRedirectToForServer(JURY), `${JURY}/auth/reset-callback`);
    assert.equal(getPasswordRecoveryRedirectToForServer(PREVIEW), `${PREVIEW}/auth/reset-callback`);
    assert.equal(buildPasswordRecoveryPageUrlWithToken('abc', JURY), `${JURY}/reset-password?token=abc`);
    for (const o of [undefined, null, 'https://evil.example', 'http://localhost:3000', 'https://jury.aisleshub.com:444']) {
      assert.equal(getPasswordRecoveryRedirectToForServer(o), `${PROD}/auth/reset-callback`, String(o));
      assert.equal(buildPasswordRecoveryPageUrlWithToken('abc', o), `${PROD}/reset-password?token=abc`, String(o));
    }
  });
  assert.equal(resolveEmailLinkBase('http://127.0.0.1:3000', PROD), PROD);
  assert.equal(requestUrlOrigin('https://jury.aisleshub.com/api/auth/forgot-password'), JURY);
  assert.equal(requestUrlOrigin('::bad'), null);
});

test('11. NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO keeps precedence', () => {
  withEnv({ ...NO_ENV, NEXT_PUBLIC_PASSWORD_RECOVERY_REDIRECT_TO: 'https://override.example/auth/reset-callback/' }, () => {
    assert.equal(getPasswordRecoveryRedirectToForServer(JURY), 'https://override.example/auth/reset-callback');
  });
  const fp = src('src/app/api/auth/forgot-password/route.ts');
  assert.match(fp, /const requestOrigin = requestUrlOrigin\(request\.url\);\n\s+let redirectTo = getPasswordRecoveryRedirectToForServer\(requestOrigin\);/);
  assert.match(fp, /redirectTo = buildPasswordRecoveryPageUrlWithToken\(token, requestOrigin\);/);
});

test('12. Jury login page shows exactly one notice: conflict (shared constant) else email-unverified', () => {
  const page = src('src/app/(root)/jury/login/page.tsx');
  assert.match(page, /notice=\{juryLoginErrorNotice\(typeof params\.error === 'string' \? params\.error : null\) \?\? \(outcome\.notice === 'STORE_UNAVAILABLE' \? JURY_LOGIN_STORE_UNAVAILABLE_NOTICE : outcome\.notice === 'EMAIL_UNVERIFIED' \? /);
  assert.equal(juryLoginErrorNotice('account_email_conflict'), ACCOUNT_EMAIL_CONFLICT_MESSAGE);
  assert.equal(juryLoginErrorNotice('auth_callback'), AUTH_CALLBACK_EMAIL_ERROR);
  for (const e of [null, '', 'other', 'AUTH_CALLBACK', 'account_email_conflict ']) assert.equal(juryLoginErrorNotice(e), null, String(e));
  assert.ok(/[\uac00-\ud7a3]/.test(AUTH_CALLBACK_EMAIL_ERROR));
  const lc = src('src/app/(root)/login/LoginClient.tsx');
  assert.ok(!lc.includes('const AUTH_CALLBACK_EMAIL_ERROR'), 'hub uses the shared constant');
  assert.ok(!lc.includes('AUTH_CALLBACK_EMAIL_ERROR'), 'hub maps every callback value through authCallbackFailureText');
  assert.equal((lc.match(/authCallbackFailureText\(/g) ?? []).length, 3, 'notice, memo gate, session-recovery effect');
  assert.match(lc, /setResolvedAuthCallbackNotice\(\{ type: 'ok', text: OAUTH_RETURN_SUCCESS \}\);/);
  assert.match(lc, /setResolvedAuthCallbackNotice\(\{ type: 'err', text: failureText \}\);/);
  assert.equal((page.match(/notice=/g) ?? []).length, 1);
  assert.ok(!page.includes('ACCOUNT_EMAIL_CONFLICT_MESSAGE'));
  assert.equal(accountEmailConflictNotice('account_email_conflict')?.text, ACCOUNT_EMAIL_CONFLICT_MESSAGE);
});
