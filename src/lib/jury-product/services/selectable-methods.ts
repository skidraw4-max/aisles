/**
 * I-071: connection methods a customer may pick for a NEW connection.
 * Only implemented methods are offered. The DB enum and CONNECTION_METHODS stay unchanged,
 * so existing connections stored with other methods keep loading and rendering.
 */
import type { JuryAccessMethod } from '../records';
import { READONLY_ACCOUNT_UI_ENABLED } from './readonly-account/flags';

export type SelectableMethod = { value: JuryAccessMethod; label: string; description: string };

export type SelectableMethodFlags = { readonlyAccount: boolean; ga4Viewer?: boolean };

export function defaultSelectableMethodFlags(): SelectableMethodFlags {
  return { readonlyAccount: READONLY_ACCOUNT_UI_ENABLED };
}

const READONLY_ACCOUNT: SelectableMethod = {
  value: 'READ_ONLY_ACCOUNT',
  label: '읽기 전용 계정 로그인',
  description: '고객이 만든 읽기 전용 계정으로 화면을 관찰합니다.',
};

export function selectableAccessMethods(flags: SelectableMethodFlags = defaultSelectableMethodFlags()): SelectableMethod[] {
  const out: SelectableMethod[] = [];
  if (flags.readonlyAccount) out.push(READONLY_ACCOUNT);
  if (flags.ga4Viewer) {
    out.push({ value: 'GA4_VIEWER' as JuryAccessMethod, label: 'GA4 뷰어 초대', description: 'GA4 속성에 Jury 서비스 계정을 뷰어로 초대합니다.' });
  }
  return out;
}

export function isSelectableAccessMethod(value: string, flags: SelectableMethodFlags = defaultSelectableMethodFlags()): value is JuryAccessMethod {
  return selectableAccessMethods(flags).some((method) => method.value === value);
}
