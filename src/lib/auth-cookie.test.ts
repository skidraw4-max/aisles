/**
 * Run: node --import tsx --test src/lib/auth-cookie.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasSupabaseAuthCookie } from './auth-cookie';

describe('hasSupabaseAuthCookie', () => {
  it('returns false when there are no cookies', () => {
    assert.equal(hasSupabaseAuthCookie([]), false);
  });

  it('returns false for unrelated cookies', () => {
    assert.equal(
      hasSupabaseAuthCookie([{ name: 'theme' }, { name: 'vercel-insights' }]),
      false,
    );
  });

  it('returns false for PKCE verifier-only cookies (not a session)', () => {
    assert.equal(
      hasSupabaseAuthCookie([{ name: 'sb-abc123-auth-token-code-verifier' }]),
      false,
    );
  });

  it('returns true for a compact supabase auth token cookie', () => {
    assert.equal(
      hasSupabaseAuthCookie([{ name: 'sb-pcvyoqbyhfbpevzkwpsf-auth-token' }]),
      true,
    );
  });

  it('returns true for chunked auth token cookies', () => {
    assert.equal(
      hasSupabaseAuthCookie([
        { name: 'sb-abc-auth-token.0' },
        { name: 'sb-abc-auth-token.1' },
      ]),
      true,
    );
  });
});
