/** READ_ONLY_ACCOUNT feature flags. Enabled 2026-10-26 (I-044) after the migration and the env KEK were provisioned in Preview and Production. */
export const READONLY_ACCOUNT_PHASE1_ENABLED = true as boolean;
/** Shows the consent/credential section on the service detail page. */
export const READONLY_ACCOUNT_UI_ENABLED = true as boolean;

export function shouldShowReadonlyAccountSection(input: { uiEnabled: boolean; accessMethod: string | null | undefined }): boolean {
  return input.uiEnabled && input.accessMethod === 'READ_ONLY_ACCOUNT';
}
