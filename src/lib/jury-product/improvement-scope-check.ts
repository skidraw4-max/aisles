/**
 * Compares an agent change set with the task's allowed files.
 * It does not read the database, write a row, or judge a change gate.
 */
export const IMPROVEMENT_SCOPE_CODES = [
  'SAFE',
  'TENANT_MISMATCH',
  'NO_CHANGES',
  'PATH_ESCAPE',
  'OUTSIDE_WORKSPACE',
  'SCOPE_EXCEEDED',
  'FORBIDDEN_SCHEMA',
  'FORBIDDEN_MIGRATION',
  'FORBIDDEN_SECRET_FILE',
  'FORBIDDEN_SECURITY_CONFIG',
  'FORBIDDEN_DEPLOYMENT',
] as const;

export type ImprovementScopeCode = (typeof IMPROVEMENT_SCOPE_CODES)[number];

export type ImprovementScopeResult =
  | { status: 'SAFE'; code: 'SAFE'; reason: 'WITHIN_TASK_SCOPE' }
  | { status: 'BLOCKED'; code: Exclude<ImprovementScopeCode, 'SAFE'>; reason: 'OUTSIDE_TASK_SCOPE' };

export type ImprovementScopeInput = {
  actorTenantId: string;
  taskTenantId: string;
  executionTenantId: string;
  workspaceRef: { type: string; ref: string } | null;
  allowedPaths: readonly string[];
  objective: string | null;
  constraints: readonly string[] | null;
  provenance: unknown;
  changedFiles: readonly string[];
  linkEscape?: boolean;
};

const PATH_TOKEN = /workspace\/[A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+|prisma\/schema\.prisma|prisma\/migrations\/[A-Za-z0-9._/-]+|\.env(?:\.[A-Za-z0-9._-]+)?|credentials\.json/g;

export function evaluateImprovementChangeScope(input: ImprovementScopeInput): ImprovementScopeResult {
  if (!input.actorTenantId || !input.taskTenantId || !input.executionTenantId) return blocked('TENANT_MISMATCH');
  if (input.actorTenantId !== input.taskTenantId || input.taskTenantId !== input.executionTenantId) {
    return blocked('TENANT_MISMATCH');
  }
  if (input.linkEscape) return blocked('PATH_ESCAPE');
  if (input.changedFiles.length === 0) return blocked('NO_CHANGES');
  const allowed = allowList(input);
  const workspace = input.workspaceRef?.type === 'PROJECT' ? input.workspaceRef.ref : null;
  for (const file of input.changedFiles) {
    const code = fileCode(file, workspace, allowed);
    if (code) return blocked(code);
  }
  return { status: 'SAFE', code: 'SAFE', reason: 'WITHIN_TASK_SCOPE' };
}

function blocked(code: Exclude<ImprovementScopeCode, 'SAFE'>): ImprovementScopeResult {
  return { status: 'BLOCKED', code, reason: 'OUTSIDE_TASK_SCOPE' };
}

function fileCode(file: string, workspace: string | null, allowed: ReadonlySet<string>): Exclude<ImprovementScopeCode, 'SAFE'> | null {
  if (escapes(file)) return 'PATH_ESCAPE';
  const normalized = normalize(file);
  if (explicitlyAllowed(normalized, allowed)) return null;
  const denied = deniedCode(normalized);
  if (denied) return denied;
  if (!insideWorkspace(normalized, workspace)) return 'OUTSIDE_WORKSPACE';
  if (allowed.size > 0 && !explicitlyAllowed(normalized, allowed)) return 'SCOPE_EXCEEDED';
  return null;
}

function escapes(file: string): boolean {
  const value = file.trim();
  return (
    value.length === 0 ||
    value.includes('..') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    value.includes('\\') ||
    /^[a-zA-Z]:/.test(value)
  );
}

function deniedCode(file: string): Exclude<ImprovementScopeCode, 'SAFE'> | null {
  const lower = file.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (lower === 'prisma/schema.prisma' || lower.endsWith('/prisma/schema.prisma')) return 'FORBIDDEN_SCHEMA';
  if (lower === 'prisma/migrations' || lower.startsWith('prisma/migrations/') || lower.includes('/prisma/migrations/')) {
    return 'FORBIDDEN_MIGRATION';
  }
  if (base === '.env' || base.startsWith('.env.') || base === 'credentials.json' || base.endsWith('.pem') || base === 'id_rsa') {
    return 'FORBIDDEN_SECRET_FILE';
  }
  if (/(?:^|\/)(?:auth|security)\.(?:config|json|ya?ml|ts)$/.test(lower)) return 'FORBIDDEN_SECURITY_CONFIG';
  if (base === 'vercel.json' || base === 'dockerfile' || base === 'docker-compose.yml' || lower.includes('/.github/workflows/')) {
    return 'FORBIDDEN_DEPLOYMENT';
  }
  return null;
}

function insideWorkspace(file: string, workspace: string | null): boolean {
  if (!workspace) return false;
  if (file.startsWith(`workspace/${workspace}/`)) return true;
  if (file.startsWith(`data/jury-product/workspaces/${workspace}/`)) return true;
  return !file.includes('/');
}

function explicitlyAllowed(file: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(file)) return true;
  for (const entry of allowed) {
    if (entry.endsWith(`/${file}`) || file.endsWith(`/${entry}`)) return true;
  }
  return false;
}

function allowList(input: ImprovementScopeInput): Set<string> {
  const found = new Set<string>();
  for (const file of input.allowedPaths) addPath(found, file);
  addStructured(found, input.provenance);
  collect(found, input.objective ?? '');
  for (const constraint of input.constraints ?? []) collect(found, constraint);
  return found;
}

function addStructured(found: Set<string>, value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as { allowedPaths?: unknown; targetFiles?: unknown };
  if (Array.isArray(record.allowedPaths)) {
    for (const file of record.allowedPaths) if (typeof file === 'string') addPath(found, file);
  }
  if (Array.isArray(record.targetFiles)) {
    for (const file of record.targetFiles) if (typeof file === 'string') addPath(found, file);
  }
  collect(found, JSON.stringify(value));
}

function collect(found: Set<string>, text: string): void {
  for (const match of text.matchAll(new RegExp(PATH_TOKEN.source, 'g'))) addPath(found, match[0]);
}

function addPath(found: Set<string>, file: string): void {
  if (escapes(file)) return;
  found.add(normalize(file));
}

function normalize(file: string): string {
  return file.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
