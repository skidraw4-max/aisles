import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { JURY_USER_MANUAL_FILE, JURY_USER_MANUAL_PDF } from './jury-user-manual';

test('user manual public path matches shipped asset', () => {
  assert.equal(JURY_USER_MANUAL_PDF, `/jury/manual/${JURY_USER_MANUAL_FILE}`);
  const asset = path.join(process.cwd(), 'public', 'jury', 'manual', JURY_USER_MANUAL_FILE);
  assert.equal(existsSync(asset), true, `missing ${asset} — run npm run docs:manual-pdf`);
});

test('manual links appear on landing, auth, home, and settings', () => {
  const landing = readFileSync('src/components/jury/JuryLanding.tsx', 'utf8');
  const login = readFileSync('src/components/jury/JuryLoginForm.tsx', 'utf8');
  const signup = readFileSync('src/components/jury/JurySignupForm.tsx', 'utf8');
  const ui = readFileSync('src/app/(jury)/jury/ui.tsx', 'utf8');
  assert.match(landing, /JuryUserManualLinks/);
  assert.match(login, /JuryUserManualLinks/);
  assert.match(signup, /JuryUserManualLinks/);
  assert.match(ui, /JuryUserManualLinks variant="header"/);
  assert.match(ui, /사용자 매뉴얼/);
});
