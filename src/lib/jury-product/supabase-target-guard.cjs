'use strict';
/**
 * Preview Supabase API target guard (pure, no network, no output).
 *
 * Active only when VERCEL_ENV === 'preview' or JURY_PREVIEW_DB === '1'; elsewhere it returns
 * SUPABASE_TARGET_SKIPPED so Production/local behavior is unchanged.
 * Refs come from the same configuration as the Prisma DB target guard
 * (JURY_PREVIEW_DB_PROJECT_REF / JURY_PRODUCTION_DB_PROJECT_REFS).
 *
 * The result only ever contains fixed codes; input values are never returned or logged.
 * A passing result proves URL/key *shape and declared ref* only, not the real project
 * behind an sb_ key (those carry no ref: keyRef = 'unverifiable').
 */
const { readRefConfig, readProductionRefs } = require('./db-target-classifier.cjs');

const URL_VAR = 'NEXT_PUBLIC_SUPABASE_URL';
const ANON_VAR = 'NEXT_PUBLIC_SUPABASE_ANON_KEY';
const SERVICE_VAR = 'SUPABASE_SERVICE_ROLE_KEY';
const B64URL = /^[A-Za-z0-9_-]+$/;

function isPreviewScope(env) {
  const e = env || {};
  return e.VERCEL_ENV === 'preview' || e.JURY_PREVIEW_DB === '1';
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Legacy JWT payload object, or null. */
function decodeJwtPayload(key) {
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;
  if (parts[2] && !B64URL.test(parts[2])) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : null;
  } catch {
    return null;
  }
}

function mentionsAny(value, refs) {
  if (!value) return false;
  const lower = value.toLowerCase();
  let decoded = lower;
  try {
    decoded = decodeURIComponent(lower);
  } catch {
    // keep raw
  }
  return refs.some((r) => lower.includes(r) || decoded.includes(r));
}

function keyMentionsProduction(key, refs) {
  if (!key) return false;
  if (mentionsAny(key, refs)) return true;
  const p = decodeJwtPayload(key);
  if (!p) return false;
  if (typeof p.ref === 'string' && refs.includes(p.ref.toLowerCase())) return true;
  try {
    return mentionsAny(JSON.stringify(p), refs);
  } catch {
    return false;
  }
}

/** 'ok' | 'unverifiable' | 'mismatch' | 'undecodable' */
function classifyKey(key, kind, previewRef) {
  if (key.startsWith('sb_')) {
    const prefix = kind === 'anon' ? 'sb_publishable_' : 'sb_secret_';
    return key.startsWith(prefix) && key.length > prefix.length ? 'unverifiable' : 'mismatch';
  }
  const p = decodeJwtPayload(key);
  if (!p) return 'undecodable';
  const role = kind === 'anon' ? 'anon' : 'service_role';
  return p.ref === previewRef && p.role === role ? 'ok' : 'mismatch';
}

function urlMatchesPreview(raw, previewRef) {
  const expected = `https://${previewRef}.supabase.co`;
  if (raw !== expected && raw !== `${expected}/`) return false;
  try {
    const u = new URL(raw);
    return (
      u.protocol === 'https:' && u.hostname === `${previewRef}.supabase.co` && u.port === '' &&
      (u.pathname === '/' || u.pathname === '') && u.search === '' && u.hash === '' &&
      u.username === '' && u.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * @param env process.env-like object
 * @param opts { checkAnonKey?: boolean (default true), requireServiceKey?: boolean,
 *               checkServiceKeyIfPresent?: boolean }
 * @returns {{ ok: boolean, code: string, keyRef?: 'verified'|'unverifiable' }}
 */
function checkSupabaseTarget(env, opts) {
  const e = env || {};
  const o = opts || {};
  try {
    if (!isPreviewScope(e)) return { ok: true, code: 'SUPABASE_TARGET_SKIPPED' };

    const refs = readRefConfig(e);
    if (!refs) {
      // Even with broken config, an obvious Production mention is reported first.
      const prod = readProductionRefs(e);
      if (prod.length && [e[URL_VAR], e[ANON_VAR], e[SERVICE_VAR]].some((v) => keyMentionsProduction(str(v), prod))) {
        return { ok: false, code: 'BLOCKED_SUPABASE_PRODUCTION' };
      }
      return { ok: false, code: 'SUPABASE_TARGET_CONFIG' };
    }

    const url = str(e[URL_VAR]);
    const checkAnon = o.checkAnonKey !== false;
    const anon = str(e[ANON_VAR]);
    const service = str(e[SERVICE_VAR]);
    const checkService = !!o.requireServiceKey || (!!o.checkServiceKeyIfPresent && service !== '');

    const prodRefs = refs.productionRefs;
    if (
      mentionsAny(url, prodRefs) ||
      (checkAnon && keyMentionsProduction(anon, prodRefs)) ||
      (checkService && keyMentionsProduction(service, prodRefs))
    ) {
      return { ok: false, code: 'BLOCKED_SUPABASE_PRODUCTION' };
    }

    if (!url) return { ok: false, code: 'BLOCKED_SUPABASE_URL_MISSING' };
    if (!urlMatchesPreview(url, refs.previewRef)) return { ok: false, code: 'BLOCKED_SUPABASE_UNVERIFIED' };

    const verdicts = [];
    if (checkAnon) {
      if (!anon) return { ok: false, code: 'BLOCKED_SUPABASE_KEY_MISSING' };
      verdicts.push(classifyKey(anon, 'anon', refs.previewRef));
    }
    if (checkService) {
      if (!service) return { ok: false, code: 'BLOCKED_SUPABASE_KEY_MISSING' };
      verdicts.push(classifyKey(service, 'service', refs.previewRef));
    }
    if (verdicts.includes('undecodable')) return { ok: false, code: 'BLOCKED_SUPABASE_KEY_UNDECODABLE' };
    if (verdicts.includes('mismatch')) return { ok: false, code: 'BLOCKED_SUPABASE_KEY_MISMATCH' };
    if (verdicts.includes('unverifiable')) {
      return { ok: true, code: 'SUPABASE_TARGET_OK_KEY_REF_UNVERIFIABLE', keyRef: 'unverifiable' };
    }
    return { ok: true, code: 'SUPABASE_TARGET_OK', keyRef: 'verified' };
  } catch {
    return { ok: false, code: 'SUPABASE_TARGET_CONFIG' };
  }
}

/** Throws Error(<fixed code>) when blocked; never includes input values. */
function requireSupabaseTarget(env, opts) {
  const r = checkSupabaseTarget(env, opts);
  if (!r.ok) throw new Error(r.code);
  return r;
}

module.exports = { isPreviewScope, checkSupabaseTarget, requireSupabaseTarget };
