/**
 * Checks one improvement task before an agent runs.
 * It does not read the database, write a row, or start an agent.
 */
export const AUTO_LOOP_PREFLIGHT_CODES = [
  'SAFE',
  'TENANT_MISMATCH',
  'TASK_NOT_OPEN',
  'TASK_TYPE_UNSUPPORTED',
  'OBJECTIVE_MISSING',
  'CONSTRAINTS_MISSING',
  'PROVENANCE_MISSING',
  'CREDENTIAL_DETECTED',
  'FORBIDDEN_SCHEMA_CHANGE',
  'FORBIDDEN_MIGRATION',
  'FORBIDDEN_CREDENTIAL_CHANGE',
  'FORBIDDEN_AUTH_CHANGE',
  'FORBIDDEN_SECURITY_CONFIG',
  'FORBIDDEN_DEPLOYMENT',
  'TASK_INCOMPLETE',
] as const;

export type AutoLoopPreflightCode = (typeof AUTO_LOOP_PREFLIGHT_CODES)[number];

export type AutoLoopPreflightInput = {
  actorTenantId: string;
  tenantId: string;
  status: string;
  taskType: string;
  title: string | null;
  description: string | null;
  reason: string | null;
  objective: string | null;
  constraints: unknown;
  provenance: unknown;
};

export type AutoLoopPreflightResult =
  | { status: 'SAFE'; code: 'SAFE' }
  | { status: 'BLOCKED'; code: Exclude<AutoLoopPreflightCode, 'SAFE'> };

const SUPPORTED_TASK_TYPE = 'REWORD';

const CREDENTIAL_VALUE =
  /(?:postgres|postgresql|mysql|redis|mongodb):\/\/|(?:api[_-]?key|apikey|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{6,}|\b(?:sk|rk)-[A-Za-z0-9]{10,}\b|\bAKIA[0-9A-Z]{16}\b/i;

const FORBIDDEN: Array<{ code: Exclude<AutoLoopPreflightCode, 'SAFE'>; pattern: RegExp }> = [
  { code: 'FORBIDDEN_SCHEMA_CHANGE', pattern: /\b(?:alter|drop|create)\s+table\b|production\s+database\s+schema|데이터베이스\s*스키마를?\s*(?:변경|수정|바꾸)/i },
  { code: 'FORBIDDEN_MIGRATION', pattern: /\bprisma\s+migrate\b|\bmigrate\s+deploy\b|\b(?:run|execute|apply)\s+(?:the\s+)?(?:db\s+)?migrations?\b|마이그레이션을?\s*(?:실행|적용)/i },
  { code: 'FORBIDDEN_CREDENTIAL_CHANGE', pattern: /\b(?:rotate|replace|reset|change|update)\s+(?:the\s+)?(?:api\s*keys?|secrets?|passwords?|credentials?)\b|자격\s*증명을?\s*(?:변경|교체|갱신)|비밀번호를?\s*(?:변경|교체|재설정)/i },
  { code: 'FORBIDDEN_AUTH_CHANGE', pattern: /\b(?:change|modify|disable|bypass)\s+(?:the\s+)?(?:authentication|authorization)\b|인증을?\s*(?:변경|우회|비활성화)|권한을?\s*(?:변경|확대|우회)/i },
  { code: 'FORBIDDEN_SECURITY_CONFIG', pattern: /\bsecurity\s+configuration\b|\b(?:disable|weaken|change)\s+(?:rls|row level security)\b|보안\s*(?:설정|구성)을?\s*(?:변경|해제|비활성화)/i },
  { code: 'FORBIDDEN_DEPLOYMENT', pattern: /\bdeploy(?:\s+\S+){0,4}\s+to\s+production\b|\bproduction\s+deployment\b|운영(?:\s*환경)?에?\s*배포|프로덕션(?:에)?\s*배포/i },
];

export function evaluateAutoLoopPreflight(task: AutoLoopPreflightInput): AutoLoopPreflightResult {
  if (!task.actorTenantId || !task.tenantId) return blocked('TASK_INCOMPLETE');
  if (task.tenantId !== task.actorTenantId) return blocked('TENANT_MISMATCH');
  if (task.status !== 'OPEN') return blocked('TASK_NOT_OPEN');
  if (task.taskType !== SUPPORTED_TASK_TYPE) return blocked('TASK_TYPE_UNSUPPORTED');
  if (!text(task.objective)) return blocked('OBJECTIVE_MISSING');
  if (!constraintsOf(task.constraints)) return blocked('CONSTRAINTS_MISSING');
  if (!provenanceOf(task.provenance)) return blocked('PROVENANCE_MISSING');
  if (CREDENTIAL_VALUE.test(taskText(task))) return blocked('CREDENTIAL_DETECTED');
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(taskText(task))) return blocked(rule.code);
  }
  return { status: 'SAFE', code: 'SAFE' };
}

function blocked(code: Exclude<AutoLoopPreflightCode, 'SAFE'>): AutoLoopPreflightResult {
  return { status: 'BLOCKED', code };
}

function text(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function constraintsOf(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function provenanceOf(value: unknown): boolean {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0;
}

function taskText(task: AutoLoopPreflightInput): string {
  const constraints = Array.isArray(task.constraints) ? task.constraints.filter((item) => typeof item === 'string').join('\n') : '';
  let provenance = '';
  try {
    provenance = task.provenance == null ? '' : JSON.stringify(task.provenance);
  } catch {
    provenance = '';
  }
  return [task.title ?? '', task.description ?? '', task.reason ?? '', task.objective ?? '', constraints, provenance].join('\n');
}
