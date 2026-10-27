/**
 * I-083: one status palette for Jury badges. Maps raw status codes (and their Korean labels) to a tone.
 * Tones are rendered by StatusBadge with a lucide icon + Korean label; colors live in jury.module.css (--jury-st-*).
 */
import { userLabel } from './ui-labels';

export type StatusTone = 'pass' | 'fail' | 'partial' | 'blocked' | 'error' | 'running' | 'deleted' | 'neutral' | 'info';

const TONES: Record<Exclude<StatusTone, 'info'>, readonly string[]> = {
  pass: ['PASS', 'PASSED', 'CONNECTED', 'ACTIVE', 'COMPLETED', 'COMPLETE', 'APPROVED', 'HEALTHY', 'READY', 'ACCEPTED', 'EXECUTED', 'REVIEWED', 'LAST_RESULT_AVAILABLE', 'SUPPORTED'],
  fail: ['FAIL', 'FAILED', 'REVOKED', 'REJECTED', 'REVISION_REQUIRED'],
  partial: ['PARTIAL', 'DEGRADED', 'ACTION_REQUIRED', 'ATTENTION', 'LIMITED', 'PROPOSED', 'GATED', 'WARN'],
  blocked: ['BLOCKED', 'LOCKED', 'EXPIRED', 'CANCELLED'],
  error: ['ERROR'],
  running: ['RUNNING', 'IN_PROGRESS', 'CONNECTING', 'CONFIGURING', 'DISCOVERING', 'DISCOVERY_PENDING', 'QUEUED', 'PENDING', 'WAITING'],
  deleted: ['DELETED', 'DISCONNECTED'],
  neutral: ['NOT_TESTED', 'NOT_STARTED', 'UNCONFIGURED', 'IDLE', 'NONE', 'MISSING', 'UNKNOWN', 'DRAFT', 'NOT_READY', 'UNVERIFIED'],
};

const BY_CODE = new Map<string, StatusTone>();
for (const [tone, codes] of Object.entries(TONES) as [StatusTone, readonly string[]][]) for (const c of codes) BY_CODE.set(c, tone);

/** Korean labels that appear as literal badge text on Jury screens. */
const BY_LABEL = new Map<string, StatusTone>([
  ['확인됨', 'pass'], ['통과', 'pass'], ['완료', 'pass'],
  ['일부 확인', 'partial'], ['확인 필요', 'partial'],
  ['미확인', 'neutral'], ['미검사', 'neutral'],
  ['AI 추정', 'info'],
]);
for (const [code, tone] of BY_CODE) {
  const label = userLabel(code);
  if (label !== code && !BY_LABEL.has(label)) BY_LABEL.set(label, tone);
}

export function statusTone(status?: string | null, label?: string | null): StatusTone {
  const code = status?.trim().toUpperCase();
  if (code && BY_CODE.has(code)) return BY_CODE.get(code)!;
  const text = label?.trim();
  if (text && BY_LABEL.has(text)) return BY_LABEL.get(text)!;
  return 'info';
}

export const STATUS_TONES: readonly StatusTone[] = ['pass', 'fail', 'partial', 'blocked', 'error', 'running', 'deleted', 'neutral', 'info'];
