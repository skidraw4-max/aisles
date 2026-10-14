import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JURY_HOSTS, isJuryHost, juryRewritePath, shouldRewriteToJury } from './jury-host';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('jury host set is exactly jury.aisleshub.com', () => {
  assert.deepEqual([...JURY_HOSTS], ['jury.aisleshub.com']);
  assert.equal(isJuryHost('jury.aisleshub.com'), true);
  assert.equal(isJuryHost('JURY.aisleshub.com'), true);
  for (const h of ['www.aisleshub.com', 'aisleshub.com', 'jury.aisleshub.com.evil.example', 'xjury.aisleshub.com', 'localhost', '', null, undefined]) {
    assert.equal(isJuryHost(h), false, String(h));
  }
});

test('rewritten paths map to /jury + path', () => {
  for (const [p, t] of [['/', '/jury'], ['/login', '/jury/login'], ['/signup', '/jury/signup'], ['/services/abc', '/jury/services/abc'], ['/reviews', '/jury/reviews'], ['/invitation/tok', '/jury/invitation/tok'], ['/organization/members', '/jury/organization/members'], ['/jury-x', '/jury/jury-x'], ['/reset-passwordx', '/jury/reset-passwordx'], ['/authx', '/jury/authx'], ['/api-docs', '/jury/api-docs']]) {
    assert.equal(shouldRewriteToJury(p), true, p);
    assert.equal(juryRewritePath(p), t);
  }
});

test('excluded paths are never rewritten (no double prefix, auth/static/metadata untouched)', () => {
  for (const p of ['/jury', '/jury/', '/jury/login', '/jury/services/github/callback', '/api', '/api/jury/console', '/api/auth/forgot-password', '/_next', '/_next/static/x.js',
    '/auth', '/auth/callback', '/auth/reset-callback', '/auth/reset-password', '/auth/update-password', '/reset-password', '/reset-password/abc',
    '/favicon.ico', '/og-image.png', '/app-ads.txt', '/watermark.png', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/manifest', '/icon', '/icon1.png', '/icon/small',
    '/apple-icon', '/apple-icon.png', '/opengraph-image', '/opengraph-image-1', '/twitter-image', '/a/b.json', '', 'login']) {
    assert.equal(shouldRewriteToJury(p), false, p);
  }
});

test('middleware: /?code reset redirect runs before the jury rewrite; hub hosts unchanged', () => {
  const mw = readFileSync(path.join(repo, 'middleware.ts'), 'utf8').replace(/\r\n/g, '\n');
  const nextConfig = readFileSync(path.join(repo, 'next.config.ts'), 'utf8').replace(/\r\n/g, '\n');
  const code = mw.indexOf("u.pathname = '/auth/reset-callback';");
  const rewrite = mw.indexOf('if (isJuryHost(requestHostname(request)) && shouldRewriteToJury(pathname)) {');
  const auth = mw.indexOf('function needsAuth');
  assert.ok(code > 0 && rewrite > code && auth > rewrite);
  assert.match(mw, /return applyIndexingPolicy\(NextResponse\.rewrite\(target, \{ request: \{ headers: request\.headers \} \}\)\);/);
  assert.match(mw, /const forwardedHost = request\.headers\.get\('x-forwarded-host'\)\?\.split\('\,'\)\[0\]\?\.trim\(\);/);
  assert.match(mw, /const host = forwardedHost \|\| request\.headers\.get\('host'\) \|\| request\.nextUrl\.hostname;/);
  assert.match(mw, /matcher: \['\/\(\(\?!_next\/\|api\/\)\.\*\)'\]/);
  assert.equal((mw.match(/NextResponse\.rewrite/g) ?? []).length, 1);
  assert.match(nextConfig, /source: '\/'[\s\S]*?value: 'jury\.aisleshub\.com'[\s\S]*?destination: '\/jury'/);
  assert.match(nextConfig, /source: '\/:path\(\(\?!_next/);
  assert.match(nextConfig, /destination: '\/jury\/:path'/);
});
