'use strict';
/**
 * Shared fixture table (fake refs only) for the build policy test and the
 * TypeScript guard parity test. Each case: env + expected classifyDbTarget verdict.
 */
const PREVIEW = 'previewdummyrefaaaaa';
const PROD = 'productiondummyrefbb';
const OTHER = 'otherprojectrefzzzzz';
const PW = 'S3ntinelPassw0rd';
const REFS = { JURY_PREVIEW_DB: '1', JURY_PREVIEW_DB_PROJECT_REF: PREVIEW, JURY_PRODUCTION_DB_PROJECT_REFS: PROD };

const u = {
  direct: `postgres://postgres:${PW}@db.${PREVIEW}.supabase.co:5432/postgres`,
  dedicated: `postgresql://postgres:${PW}@db.${PREVIEW}.supabase.co:6543/postgres`,
  dedicatedOtherUser: `postgresql://postgres.${OTHER}:${PW}@db.${PREVIEW}.supabase.co:6543/postgres`,
  pooler: `postgres://postgres.${PREVIEW}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  poolerOtherRegion: `postgres://postgres.${PREVIEW}:${PW}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
  poolerNoRef: `postgres://postgres:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  poolerOtherRef: `postgres://postgres.${OTHER}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  poolerTxn: `postgres://postgres.${PREVIEW}:${PW}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`,
  prodDirect: `postgres://postgres:${PW}@db.${PROD}.supabase.co:5432/postgres`,
  prodPooler: `postgres://postgres.${PROD}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  prodPoolerOtherRegion: `postgres://postgres.${PROD}:${PW}@aws-9-eu-west-3.pooler.supabase.com:6543/postgres`,
  prodUserOnPreviewHost: `postgres://postgres.${PROD}:${PW}@db.${PREVIEW}.supabase.co:5432/postgres`,
  prodInQuery: `postgres://postgres.${PREVIEW}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?host=db.${PROD}.supabase.co`,
  prodMalformed: `not a url db.${PROD}.supabase.co`,
  otherDirect: `postgres://postgres:${PW}@db.${OTHER}.supabase.co:5432/postgres`,
  noPort: `postgres://postgres:${PW}@db.${PREVIEW}.supabase.co/postgres`,
  badPort: `postgres://postgres:${PW}@db.${PREVIEW}.supabase.co:5433/postgres`,
  httpScheme: `https://postgres:${PW}@db.${PREVIEW}.supabase.co:5432/postgres`,
  garbage: `::${PW}::not-a-url`,
  nonSupabase: `postgres://postgres.${PREVIEW}:${PW}@evil.example:5432/postgres`,
  verifyFull: `postgres://postgres:${PW}@db.${PREVIEW}.supabase.co:5432/postgres?sslmode=verify-full`,
  pgbouncer: `postgres://postgres.${PREVIEW}:${PW}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=1`,
};
const weakSsl = ['sslmode=disable', 'sslmode=require', 'sslmode=no-verify', 'sslmode=prefer', 'sslmode=verify-ca', 'ssl=false', 'ssl=true',
  'sslrootcert=system', 'sslaccept=accept_invalid_certs', 'sslcert=x', 'sslkey=x', 'sslpassword=x', 'uselibpqcompat=true',
  'SSLMODE=disable', 'sslmode=verify-full&sslmode=disable'];

const cases = [
  ['direct 5432 ok', { ...REFS, DATABASE_URL: u.direct }, 'ok'],
  ['dedicated pooler 6543 ok', { ...REFS, DATABASE_URL: u.dedicated, DIRECT_URL: u.direct }, 'ok'],
  ['dedicated pooler other user ref', { ...REFS, DATABASE_URL: u.dedicatedOtherUser }, 'unverified'],
  ['shared pooler with preview user ok', { ...REFS, DATABASE_URL: u.pooler, DIRECT_URL: u.pooler }, 'ok'],
  ['shared pooler any region ok', { ...REFS, DATABASE_URL: u.poolerOtherRegion }, 'ok'],
  ['pooler host without ref in user', { ...REFS, DATABASE_URL: u.poolerNoRef }, 'unverified'],
  ['pooler other project ref', { ...REFS, DATABASE_URL: u.poolerOtherRef }, 'unverified'],
  ['shared pooler 6543 not accepted', { ...REFS, DATABASE_URL: u.poolerTxn }, 'unverified'],
  ['verify-full tolerated', { ...REFS, DATABASE_URL: u.verifyFull }, 'ok'],
  ['pgbouncer params tolerated', { ...REFS, DATABASE_URL: u.pgbouncer }, 'ok'],
  ['production direct alone', { ...REFS, DATABASE_URL: u.prodDirect }, 'production'],
  ['production pooler', { ...REFS, DATABASE_URL: u.prodPooler }, 'production'],
  ['production pooler other region/port', { ...REFS, DATABASE_URL: u.prodPoolerOtherRegion }, 'production'],
  ['production user on preview host', { ...REFS, DATABASE_URL: u.prodUserOnPreviewHost }, 'production'],
  ['production ref in query', { ...REFS, DATABASE_URL: u.prodInQuery }, 'production'],
  ['production ref in malformed url', { ...REFS, DATABASE_URL: u.prodMalformed }, 'production'],
  ['mixed: preview db + production direct', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: u.prodDirect }, 'production'],
  ['mixed: production db + preview direct', { ...REFS, DATABASE_URL: u.prodPooler, DIRECT_URL: u.direct }, 'production'],
  ['production wins even without JURY_PREVIEW_DB', { ...REFS, JURY_PREVIEW_DB: undefined, DATABASE_URL: u.prodDirect }, 'production'],
  ['production wins even with invalid preview ref', { ...REFS, JURY_PREVIEW_DB_PROJECT_REF: 'bad', DATABASE_URL: u.prodDirect }, 'production'],
  ['production wins over an earlier unverified url', { ...REFS, DATABASE_URL: u.garbage, DIRECT_URL: u.prodPooler }, 'production'],
  ['other project direct (ref mismatch)', { ...REFS, DATABASE_URL: u.otherDirect }, 'unverified'],
  ['missing port', { ...REFS, DATABASE_URL: u.noPort }, 'unverified'],
  ['unsupported port', { ...REFS, DATABASE_URL: u.badPort }, 'unverified'],
  ['http scheme', { ...REFS, DATABASE_URL: u.httpScheme }, 'unverified'],
  ['garbage url', { ...REFS, DATABASE_URL: u.garbage }, 'unverified'],
  ['non-supabase host', { ...REFS, DATABASE_URL: u.nonSupabase }, 'unverified'],
  ['DIRECT_URL invalid', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: u.garbage }, 'unverified'],
  ['DIRECT_URL blank treated absent', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: '   ' }, 'ok'],
  ['DIRECT_URL empty treated absent', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: '' }, 'ok'],
  ['DATABASE_URL missing', { ...REFS, DIRECT_URL: u.direct }, 'config'],
  ['DATABASE_URL blank', { ...REFS, DATABASE_URL: ' ', DIRECT_URL: u.direct }, 'config'],
  ['JURY_PREVIEW_DB missing', { ...REFS, JURY_PREVIEW_DB: undefined, DATABASE_URL: u.direct }, 'config'],
  ['JURY_PREVIEW_DB not 1', { ...REFS, JURY_PREVIEW_DB: 'true', DATABASE_URL: u.direct }, 'config'],
  ['preview ref missing', { ...REFS, JURY_PREVIEW_DB_PROJECT_REF: undefined, DATABASE_URL: u.direct }, 'config'],
  ['preview ref malformed', { ...REFS, JURY_PREVIEW_DB_PROJECT_REF: 'PREVIEW', DATABASE_URL: u.direct }, 'config'],
  ['production refs missing', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: undefined, DATABASE_URL: u.direct }, 'config'],
  ['production refs malformed entry', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: `${PROD},x`, DATABASE_URL: u.direct }, 'config'],
  // Overlap: the URL's ref is listed as Production, so the stricter PRODUCTION block wins.
  ['overlapping refs', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: PREVIEW, DATABASE_URL: u.direct }, 'production'],
  ['overlapping refs, no url mention', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: PREVIEW, DATABASE_URL: u.otherDirect }, 'config'],
  ['multiple production refs ok', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: `${PROD}, ${OTHER}`, DATABASE_URL: u.direct }, 'ok'],
  ['second production ref detected', { ...REFS, JURY_PRODUCTION_DB_PROJECT_REFS: `${PROD},${OTHER}`, DATABASE_URL: u.otherDirect }, 'production'],
  ...weakSsl.map((q) => [`weak ssl param ${q}`, { ...REFS, DATABASE_URL: `${u.direct}?${q}` }, 'unverified']),
  ...weakSsl.map((q) => [`weak ssl param on DIRECT_URL ${q}`, { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: `${u.pooler}?${q}` }, 'unverified']),
];

// t74 boundary cases. Representations that cannot be safely identified must still be blocked.
const pct = (s) => [...s].map((c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).join('');
const PROD_PCT = pct(PROD);
const POOL = 'aws-0-ap-south-1.pooler.supabase.com:5432';
const edge = {
  prodUserPct: `postgres://postgres.${PROD_PCT}:${PW}@${POOL}/postgres`,
  prodUserPartPct: `postgres://postgres.%70${PROD.slice(1)}:${PW}@${POOL}/postgres`,
  prodHostPct: `postgres://postgres:${PW}@db.${PROD_PCT}.supabase.co:5432/postgres`,
  prodHostPctBadEscape: `postgres://postgres:${PW}%zz@db.${PROD_PCT}.supabase.co:5432/postgres`,
  prodUserPctBadEscape: `postgres://postgres.${PROD_PCT}:${PW}@${POOL}/postgres%zz`,
  prodUserDoublePct: `postgres://postgres.${pct(PROD).replace(/%/g, '%25')}:${PW}@${POOL}/postgres`,
  prodHostUpper: `postgres://postgres:${PW}@DB.${PROD.toUpperCase()}.SUPABASE.CO:5432/postgres`,
  prodUserMixedCase: `postgres://postgres.${PROD[0].toUpperCase()}${PROD.slice(1, 10)}${PROD.slice(10).toUpperCase()}:${PW}@${POOL}/postgres`,
  prodSchemeUpper: `POSTGRES://POSTGRES.${PROD.toUpperCase()}:${PW}@AWS-0-AP-SOUTH-1.POOLER.SUPABASE.COM:5432/postgres`,
  previewHostUpper: `postgres://postgres:${PW}@db.${PREVIEW.toUpperCase()}.supabase.co:5432/postgres`,
  ipv4: `postgres://postgres.${PREVIEW}:${PW}@10.0.0.1:5432/postgres`,
  ipv4Loopback: `postgres://postgres:${PW}@127.0.0.1:5432/postgres`,
  ipv4Decimal: `postgres://postgres.${PREVIEW}:${PW}@2130706433:5432/postgres`,
  ipv6: `postgres://postgres.${PREVIEW}:${PW}@[2001:db8::1]:5432/postgres`,
  ipv6Loopback: `postgres://postgres:${PW}@[::1]:5432/postgres`,
  ipv6Mapped: `postgres://postgres.${PREVIEW}:${PW}@[::ffff:10.0.0.1]:5432/postgres`,
  prodUserOnIpv4: `postgres://postgres.${PROD}:${PW}@10.0.0.1:5432/postgres`,
  prodUserOnIpv6: `postgres://postgres.${PROD}:${PW}@[2001:db8::1]:5432/postgres`,
};
const notOne = ['true', 'false', '', ' 1', '1 ', '01', '0', 'yes', 'TRUE', '\t1\n'];
const edgeCases = [
  ['pct-encoded production ref in username', { ...REFS, DATABASE_URL: edge.prodUserPct }, 'production'],
  ['partly pct-encoded production ref in username', { ...REFS, DATABASE_URL: edge.prodUserPartPct }, 'production'],
  ['pct-encoded production ref in host', { ...REFS, DATABASE_URL: edge.prodHostPct }, 'production'],
  ['pct-encoded production host + undecodable escape elsewhere', { ...REFS, DATABASE_URL: edge.prodHostPctBadEscape }, 'production'],
  ['pct-encoded production user + undecodable escape elsewhere', { ...REFS, DATABASE_URL: edge.prodUserPctBadEscape }, 'production'],
  ['pct-encoded production ref in DIRECT_URL', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: edge.prodHostPct }, 'production'],
  // pg decodes the userinfo once; a double-encoded ref is not a Production user, but is not verifiable either.
  ['double pct-encoded production ref: not identifiable, blocked', { ...REFS, DATABASE_URL: edge.prodUserDoublePct }, 'unverified'],
  ['production host upper case', { ...REFS, DATABASE_URL: edge.prodHostUpper }, 'production'],
  ['production ref mixed case in username', { ...REFS, DATABASE_URL: edge.prodUserMixedCase }, 'production'],
  ['production ref upper case, whole url upper case', { ...REFS, DATABASE_URL: edge.prodSchemeUpper }, 'production'],
  ['production host upper case in DIRECT_URL', { ...REFS, DATABASE_URL: u.pooler, DIRECT_URL: edge.prodHostUpper }, 'production'],
  ['production ref upper case wins without JURY_PREVIEW_DB', { ...REFS, JURY_PREVIEW_DB: 'true', DATABASE_URL: edge.prodHostUpper }, 'production'],
  // Non-lowercase Preview host is not normalised: fail closed rather than guess.
  ['preview host upper case: not verified', { ...REFS, DATABASE_URL: edge.previewHostUpper }, 'unverified'],
  ['IPv4 literal host with preview user', { ...REFS, DATABASE_URL: edge.ipv4 }, 'unverified'],
  ['IPv4 loopback host', { ...REFS, DATABASE_URL: edge.ipv4Loopback }, 'unverified'],
  ['IPv4 decimal host', { ...REFS, DATABASE_URL: edge.ipv4Decimal }, 'unverified'],
  ['IPv6 literal host with preview user', { ...REFS, DATABASE_URL: edge.ipv6 }, 'unverified'],
  ['IPv6 loopback host', { ...REFS, DATABASE_URL: edge.ipv6Loopback }, 'unverified'],
  ['IPv6 v4-mapped host', { ...REFS, DATABASE_URL: edge.ipv6Mapped }, 'unverified'],
  ['IPv4 literal in DIRECT_URL', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: edge.ipv4 }, 'unverified'],
  ['production user on IPv4 host', { ...REFS, DATABASE_URL: edge.prodUserOnIpv4 }, 'production'],
  ['production user on IPv6 host', { ...REFS, DATABASE_URL: edge.prodUserOnIpv6 }, 'production'],
  ['DIRECT_URL tab only treated absent', { ...REFS, DATABASE_URL: u.direct, DIRECT_URL: '\t' }, 'ok'],
  ['DIRECT_URL mixed whitespace treated absent', { ...REFS, DATABASE_URL: u.pooler, DIRECT_URL: ' \t\r\n ' }, 'ok'],
  ['DIRECT_URL whitespace + production DATABASE_URL', { ...REFS, DATABASE_URL: u.prodPooler, DIRECT_URL: ' \n' }, 'production'],
  ['DIRECT_URL whitespace + unverified DATABASE_URL', { ...REFS, DATABASE_URL: u.poolerNoRef, DIRECT_URL: '\t' }, 'unverified'],
  ['DATABASE_URL whitespace only (tab/newline)', { ...REFS, DATABASE_URL: '\t\n', DIRECT_URL: u.direct }, 'config'],
  ['both URLs whitespace only', { ...REFS, DATABASE_URL: ' ', DIRECT_URL: '\t' }, 'config'],
  ...notOne.map((v) => [`JURY_PREVIEW_DB=${JSON.stringify(v)} -> config`, { ...REFS, JURY_PREVIEW_DB: v, DATABASE_URL: u.direct }, 'config']),
  ...notOne.map((v) => [`JURY_PREVIEW_DB=${JSON.stringify(v)} + production ref -> production first`, { ...REFS, JURY_PREVIEW_DB: v, DATABASE_URL: u.prodDirect }, 'production']),
];
cases.push(...edgeCases);

module.exports = { cases, edgeCases, PREVIEW, PROD, PROD_PCT, OTHER, PW, REFS, urls: u, edgeUrls: edge };