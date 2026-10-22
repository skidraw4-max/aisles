/**
 * Checks whether a completed change plainly contradicts the task.
 * It does not approve the change, call a model, or write a row.
 */
export const IMPROVEMENT_INTENT_CODES = ['SAFE', 'TENANT_MISMATCH', 'INTENT_MISMATCH', 'FORBIDDEN_BEHAVIOR'] as const;

export type ImprovementIntentCode = (typeof IMPROVEMENT_INTENT_CODES)[number];

export type ImprovementIntentResult =
  | { status: 'SAFE'; code: 'SAFE'; reason: 'WITHIN_TASK_INTENT' }
  | { status: 'BLOCKED'; code: Exclude<ImprovementIntentCode, 'SAFE'>; reason: 'OUTSIDE_TASK_INTENT' };

export type ImprovementIntentChange = {
  path: string;
  kind?: string;
  text?: string | null;
};

export type ImprovementIntentInput = {
  actorTenantId: string;
  taskTenantId: string;
  executionTenantId: string;
  objective: string | null;
  constraints: readonly string[] | null;
  provenance: unknown;
  allowedPaths: readonly string[];
  workspaceRef: { type: string; ref: string } | null;
  changedFiles: readonly string[];
  changes: readonly ImprovementIntentChange[];
  summary?: string | null;
};

const FORBIDDEN_CODE = [
  /process\.env\.[A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|DATABASE_URL)\b/,
  /readFile(?:Sync)?\(\s*['"][^'"]*\.env/,
  /\bgetCredential\s*\(/,
  /\bALTER\s+TABLE\b/i,
  /\bDROP\s+TABLE\b/i,
  /prisma\.\$executeRaw/,
  /\bprisma\s+migrate\b/i,
  /\bbypassAuth\s*\(/,
  /rowLevelSecurity\s*:\s*false/,
  /\bvercel\s+deploy\b/i,
  /deploy\(\s*['"]production['"]\s*\)/,
  /auth(?:Config)?\s*[:=]\s*\{[^}]{0,120}enabled\s*:\s*false/,
] as const;

const CONSTRAINT_CONTRADICTIONS: Array<{ includes: string; pattern: RegExp }> = [
  { includes: 'Evidence 값을 변경하지 않는다', pattern: /\bevidence\.(?:value|contentHash)\s*=|\bcontentHash\s*=/ },
  { includes: 'metric 값을 변경하지 않는다', pattern: /\bnewUsersLast7d\s*=|\bmetric\.value\s*=|\bga4\.newUsers\s*=/ },
  { includes: 'Evidence provenance를 변경하지 않는다', pattern: /\bprovenance\s*=/ },
  { includes: '데이터 수집 결과를 임의로 변경하지 않는다', pattern: /\bcollectedAt\s*=|\brawPayloadRef\s*=/ },
  { includes: '기존 Jury decision contract를 변경하지 않는다', pattern: /\bexpectedDecision\s*=/ },
];

export function evaluateImprovementIntent(input: ImprovementIntentInput): ImprovementIntentResult {
  if (!input.actorTenantId || !input.taskTenantId || !input.executionTenantId) return blocked('TENANT_MISMATCH');
  if (input.actorTenantId !== input.taskTenantId || input.taskTenantId !== input.executionTenantId) {
    return blocked('TENANT_MISMATCH');
  }
  const text = changeText(input);
  if (FORBIDDEN_CODE.some((pattern) => pattern.test(text))) return blocked('FORBIDDEN_BEHAVIOR');
  const constraints = (input.constraints ?? []).join('\n');
  if (CONSTRAINT_CONTRADICTIONS.some((rule) => constraints.includes(rule.includes) && rule.pattern.test(text))) {
    return blocked('INTENT_MISMATCH');
  }
  return { status: 'SAFE', code: 'SAFE', reason: 'WITHIN_TASK_INTENT' };
}

function blocked(code: Exclude<ImprovementIntentCode, 'SAFE'>): ImprovementIntentResult {
  return { status: 'BLOCKED', code, reason: 'OUTSIDE_TASK_INTENT' };
}

function changeText(input: ImprovementIntentInput): string {
  const parts = [input.summary ?? ''];
  for (const change of input.changes) parts.push(change.text ?? '');
  return parts.map(stripComments).join('\n');
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
