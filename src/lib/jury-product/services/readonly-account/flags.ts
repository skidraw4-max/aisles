/** READ_ONLY_ACCOUNT feature flags. All OFF until production approval (migration, key provider, legal). */
export const READONLY_ACCOUNT_PHASE1_ENABLED = false as boolean;
/** Shows the consent/credential section on the service detail page. */
export const READONLY_ACCOUNT_UI_ENABLED = false as boolean;

export function shouldShowReadonlyAccountSection(input: { uiEnabled: boolean; accessMethod: string | null | undefined }): boolean {
  return input.uiEnabled && input.accessMethod === 'READ_ONLY_ACCOUNT';
}
