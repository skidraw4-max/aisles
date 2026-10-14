import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ORGANIZATION_CREATE_FAILED_EVENT,
  logOrganizationCreateFailure,
  organizationCreateDecisionDiagnostic,
  organizationCreateErrorDiagnostic,
  organizationCreatePrismaCode,
  type OrganizationCreateDiagnostic,
} from './organization-create-diagnostic';

const SENTINELS = [
  'secret.person@example.invalid',
  '11111111-2222-3333-4444-555555555555',
  'SENTINEL_TOKEN_abc',
  'SENTINEL_PASSWORD_xyz',
  'db.sentinel-host.invalid',
];

function capture() {
  const calls: Array<[string, OrganizationCreateDiagnostic]> = [];
  return { calls, log: (event: string, detail: OrganizationCreateDiagnostic) => { calls.push([event, detail]); } };
}

function prismaLike(name: string, code?: unknown) {
  const error = new Error(`boom ${SENTINELS.join(' ')}`) as Error & Record<string, unknown>;
  error.name = name;
  if (code !== undefined) error.code = code;
  error.meta = { target: ['email'], driverAdapterError: { cause: { host: SENTINELS[4], originalMessage: SENTINELS[3] } } };
  error.cause = new Error(SENTINELS.join(' '));
  error.stack = `Error: ${SENTINELS.join(' ')}`;
  error.digest = SENTINELS[2];
  return error;
}

test('P2028 and P2002 classify as prisma_known with the code', () => {
  assert.deepEqual(organizationCreateErrorDiagnostic('create_org', prismaLike('PrismaClientKnownRequestError', 'P2028')), {
    stage: 'create_org', kind: 'prisma_known', prismaCode: 'P2028', errorName: 'PrismaClientKnownRequestError',
  });
  assert.deepEqual(organizationCreateErrorDiagnostic('ensure_user', prismaLike('PrismaClientKnownRequestError', 'P2002')), {
    stage: 'ensure_user', kind: 'prisma_known', prismaCode: 'P2002', errorName: 'PrismaClientKnownRequestError',
  });
});

test('runtime-mapped connection codes classify as connection', () => {
  for (const code of ['P1001', 'P1008', 'P1011', 'P1017', 'P2037']) {
    const d = organizationCreateErrorDiagnostic('create_org', prismaLike('PrismaClientKnownRequestError', code));
    assert.equal(d.kind, 'connection', code);
    assert.equal(d.prismaCode, code);
  }
  assert.equal(organizationCreateErrorDiagnostic('create_org', prismaLike('PrismaClientKnownRequestError', 'P1002')).kind, 'prisma_known');
});

test('codeless pool timeout error is unknown with null code and no message', () => {
  const { calls, log } = capture();
  const d = organizationCreateErrorDiagnostic('create_org', new Error('timeout exceeded when trying to connect'));
  assert.deepEqual(d, { stage: 'create_org', kind: 'unknown', prismaCode: null, errorName: 'Error' });
  logOrganizationCreateFailure(d, log);
  assert.equal(JSON.stringify(calls).includes('timeout exceeded'), false);
});

test('malformed codes become null', () => {
  assert.equal(organizationCreatePrismaCode({ code: 'P20021' }), null);
  assert.equal(organizationCreatePrismaCode({ code: 123 }), null);
  assert.equal(organizationCreatePrismaCode({ code: 'p2002' }), null);
  assert.equal(organizationCreatePrismaCode(null), null);
  assert.equal(organizationCreatePrismaCode('P2002'), null);
  const d = organizationCreateErrorDiagnostic('create_org', prismaLike('PrismaClientUnknownRequestError', 'P20021'));
  assert.deepEqual(d, { stage: 'create_org', kind: 'prisma_other', prismaCode: null, errorName: 'PrismaClientUnknownRequestError' });
});

test('unlisted error names become other; non-objects are unknown', () => {
  assert.equal(organizationCreateErrorDiagnostic('cookie', prismaLike(SENTINELS[0])).errorName, 'other');
  assert.deepEqual(organizationCreateErrorDiagnostic('auth', SENTINELS[2]), { stage: 'auth', kind: 'unknown', prismaCode: null, errorName: null });
});

test('sentinels in message, meta, cause, stack, digest never reach logged args', () => {
  const { calls, log } = capture();
  for (const err of [prismaLike('PrismaClientKnownRequestError', 'P2002'), prismaLike('Weird'), prismaLike('DriverAdapterError')]) {
    logOrganizationCreateFailure(organizationCreateErrorDiagnostic('ensure_user', err), log);
  }
  const out = JSON.stringify(calls);
  for (const s of SENTINELS) assert.equal(out.includes(s), false, s);
  for (const [event, detail] of calls) {
    assert.equal(event, '[jury-org] CREATE_FAILED');
    assert.deepEqual(Object.keys(detail).sort(), ['errorName', 'kind', 'prismaCode', 'stage']);
  }
});

test('extra fields on a detail object are not forwarded', () => {
  const { calls, log } = capture();
  const tainted = { ...organizationCreateDecisionDiagnostic('USER_NOT_FOUND'), email: SENTINELS[0] } as OrganizationCreateDiagnostic;
  logOrganizationCreateFailure(tainted, log);
  assert.equal(JSON.stringify(calls).includes(SENTINELS[0]), false);
});

test('rejected decision logs the allowlisted reason only', () => {
  const { calls, log } = capture();
  logOrganizationCreateFailure(organizationCreateDecisionDiagnostic('USER_NOT_FOUND'), log);
  assert.deepEqual(calls, [[ORGANIZATION_CREATE_FAILED_EVENT, {
    stage: 'decision', kind: 'decision_rejected', prismaCode: null, errorName: null, reason: 'USER_NOT_FOUND',
  }]]);
  assert.equal('reason' in organizationCreateDecisionDiagnostic(SENTINELS[0]), false);
  assert.equal('reason' in organizationCreateDecisionDiagnostic(undefined), false);
});

test('no log call happens unless a failure is reported', () => {
  const { calls } = capture();
  organizationCreateErrorDiagnostic('create_org', prismaLike('PrismaClientKnownRequestError', 'P2028'));
  organizationCreateDecisionDiagnostic('USER_NOT_FOUND');
  assert.equal(calls.length, 0);
});

test('action keeps messages and return structure; logs only on failure paths', () => {
  const src = readFileSync(new URL('../../app/(jury)/jury/organization/actions.ts', import.meta.url), 'utf8');
  const create = src.slice(src.indexOf('export async function createJuryOrganization'), src.indexOf('export async function switchJuryOrganization'));
  assert.match(create, /Promise<\{ ok: true \} \| \{ ok: false; message: string \}>/);
  assert.match(create, /organizationCreationMessage\('UNAUTHENTICATED'\)/);
  assert.match(create, /organizationCreationMessage\('EMAIL_UNVERIFIED'\)/);
  assert.equal((create.match(/organizationCreationMessage\('FAILED'\)/g) ?? []).length, 2);
  assert.equal((create.match(/logOrganizationCreateFailure\(/g) ?? []).length, 2);
  assert.match(create, /return \{ ok: true \};/);
  assert.doesNotMatch(create, /console\./);
  assert.doesNotMatch(create, /\.message|String\(error\)|\.stack|\.meta|\.cause/);
  const ok = create.indexOf('return { ok: true };');
  const lastLog = create.lastIndexOf('logOrganizationCreateFailure(organizationCreateDecisionDiagnostic');
  assert.ok(lastLog < ok);
});
