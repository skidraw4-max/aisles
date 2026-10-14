import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreviewDiagHandler, type DiagChecks, type PreviewDiagDeps } from './preview-diagnostics';

const SECRET = 'SENTINEL_SECRET_xyz';
const req = () => new Request('https://example.test/api/admin/preview-diagnostics');

function make(result: () => Promise<unknown>, counter = { checks: 0 }): PreviewDiagDeps {
  const checks = new Proxy({}, {
    get: () => () => { counter.checks += 1; throw new Error('should not run'); },
  }) as DiagChecks;
  return {
    env: { VERCEL_ENV: 'preview' },
    rateLimit: () => false,
    loadAuth: async () => ({ classifyAdminAuth: result as () => Promise<{ ok: boolean; code?: string }> }),
    checks,
  };
}

async function expectCode(result: () => Promise<unknown>, status: number, code: string) {
  const counter = { checks: 0 };
  const res = await createPreviewDiagHandler(make(result, counter))(req());
  assert.equal(res.status, status);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { code });
  assert.ok(!text.includes('SENTINEL'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private, max-age=0');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(counter.checks, 0, 'no checks before auth success');
}

test('UNAUTHORIZED -> 401', () => expectCode(async () => ({ ok: false, code: 'UNAUTHORIZED', error: SECRET }), 401, 'UNAUTHORIZED'));
test('FORBIDDEN -> 403', () => expectCode(async () => ({ ok: false, code: 'FORBIDDEN' }), 403, 'FORBIDDEN'));
test('AUTH_UNAVAILABLE -> 503', () => expectCode(async () => ({ ok: false, code: 'AUTH_UNAVAILABLE' }), 503, 'AUTH_UNAVAILABLE'));
test('DB_UNAVAILABLE -> 503', () => expectCode(async () => ({ ok: false, code: 'DB_UNAVAILABLE' }), 503, 'DB_UNAVAILABLE'));
test('unknown code / throw -> 503 ADMIN_AUTH_UNAVAILABLE', async () => {
  await expectCode(async () => ({ ok: false, code: SECRET }), 503, 'ADMIN_AUTH_UNAVAILABLE');
  await expectCode(async () => { throw new Error(SECRET); }, 503, 'ADMIN_AUTH_UNAVAILABLE');
});
test('auth module import failure (guard/CA) -> 503 ADMIN_AUTH_UNAVAILABLE', async () => {
  const d = make(async () => ({ ok: true }));
  d.loadAuth = async () => { throw new Error(`BLOCKED_PREVIEW_DB ${SECRET}`); };
  const res = await createPreviewDiagHandler(d)(req());
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { code: 'ADMIN_AUTH_UNAVAILABLE' });
});
