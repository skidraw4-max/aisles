import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  classifyJurySignUpResult,
  juryAuthErrorMessage,
  jurySignupIssueMessage,
  maskJuryEmail,
  validateJurySignup,
} from './jury-signup';
import { juryEmailVerificationDestination, jurySignupHref, safeJuryNext } from './jury-url';

const blank = { email: '', password: '', confirmPassword: '' };

test('jury signup rejects empty and invalid fields before any auth call', () => {
  assert.equal(validateJurySignup(blank), 'email_required');
  assert.equal(validateJurySignup({ ...blank, email: 'not-an-email' }), 'email_invalid');
  assert.equal(validateJurySignup({ ...blank, email: 'person@example.com' }), 'password_required');
  assert.equal(
    validateJurySignup({ email: 'person@example.com', password: 'short', confirmPassword: 'short' }),
    'password_short',
  );
  assert.equal(
    validateJurySignup({ email: 'person@example.com', password: 'secret1', confirmPassword: 'secret2' }),
    'password_mismatch',
  );
  assert.equal(validateJurySignup({ email: ' person@example.com ', password: 'secret1', confirmPassword: 'secret1' }), null);
  assert.match(jurySignupIssueMessage('password_mismatch'), /do not match/);
});

test('jury signup success asks for verification and an existing account stays a safe error', () => {
  assert.equal(
    classifyJurySignUpResult({
      user: { email_confirmed_at: null, identities: [{ id: 'new' }] },
      session: null,
    }),
    'verify',
  );
  assert.equal(
    classifyJurySignUpResult({
      user: { email_confirmed_at: '2026-10-08T00:00:00.000Z', identities: [{ id: 'verified' }] },
      session: { access_token: 'session' },
    }),
    'enter',
  );
  assert.equal(
    classifyJurySignUpResult({ errorMessage: 'User already registered' }),
    'existing',
  );
  assert.equal(
    classifyJurySignUpResult({ user: { identities: [] }, session: null }),
    'existing',
  );
  assert.equal(classifyJurySignUpResult({ errorMessage: 'database connection string leaked' }), 'failed');
  assert.equal(juryAuthErrorMessage('User already registered'), 'This email is already registered. Sign in instead.');
  assert.equal(juryAuthErrorMessage('database connection string leaked'), 'Could not create the account. Try again.');
  assert.equal(juryAuthErrorMessage('User already registered').includes('registered'), true);
  assert.equal(juryAuthErrorMessage('secret internal host').includes('secret'), false);
  assert.equal(maskJuryEmail('jane@example.com'), 'j***@example.com');
});

test('verification callback destination and next stay inside Jury', () => {
  const destination = juryEmailVerificationDestination('https://www.aisleshub.com');
  assert.equal(destination, 'https://www.aisleshub.com/auth/callback?next=%2Fjury');
  assert.equal(safeJuryNext('/jury'), '/jury');
  assert.equal(safeJuryNext('/jury/login'), '/jury/login');
  assert.equal(safeJuryNext('/reviews'), '/jury/reviews');
  assert.equal(safeJuryNext('https://evil.example.com'), '/jury');
  assert.equal(safeJuryNext('//evil.example.com'), '/jury');
  assert.equal(safeJuryNext('javascript:alert(1)'), '/jury');
  assert.equal(safeJuryNext('%2F%2Fevil.example.com'), '/jury');
  assert.equal(safeJuryNext('/jury/../../etc/passwd'), '/jury');
  assert.equal(jurySignupHref(), '/jury/signup');
  assert.equal(jurySignupHref('https://jury.aisleshub.com'), 'https://jury.aisleshub.com/signup');
});

test('jury signup uses Supabase signUp and leaves hub signup in place', () => {
  const form = readFileSync(new URL('../../components/jury/JurySignupForm.tsx', import.meta.url), 'utf8');
  const notice = readFileSync(new URL('../../components/jury/JuryEmailNotice.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../../app/(root)/jury/signup/page.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../../app/(root)/jury/page.tsx', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../supabase-auth-callback.ts', import.meta.url), 'utf8');
  const hubSignup = readFileSync(new URL('../../app/api/auth/signup/route.ts', import.meta.url), 'utf8');
  const hubLogin = readFileSync(new URL('../../app/(root)/login/LoginClient.tsx', import.meta.url), 'utf8');
  assert.match(form, /signUp\(/);
  assert.match(form, /juryEmailVerificationDestination/);
  assert.match(form, /classifyJurySignUpResult/);
  assert.match(form, /signInWithOAuth/);
  assert.equal(form.includes('/api/auth/signup'), false);
  assert.equal(form.includes('createJuryTenant'), false);
  assert.equal(form.includes('JuryMembership'), false);
  assert.match(notice, /Check your email/);
  assert.match(notice, /Back to Sign In/);
  assert.match(notice, /Resend verification email/);
  assert.match(notice, /juryHref\('\/login'\)/);
  assert.match(page, /getJuryEntry/);
  assert.match(page, /JurySignupForm/);
  assert.match(dashboard, /EMAIL_UNVERIFIED/);
  assert.match(dashboard, /JuryEmailNotice/);
  assert.match(callback, /nextParam\?\.startsWith\('\/'\) && !nextParam\.startsWith\('\/\/'\)/);
  assert.match(hubSignup, /email_confirm: true/);
  assert.match(hubLogin, /signupParam === '1'/);
});
