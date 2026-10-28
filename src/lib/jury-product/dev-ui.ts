/**
 * UX stage 2: Mock-only and not-yet-implemented controls stay hidden from normal users.
 * They render only when NEXT_PUBLIC_JURY_DEV_UI is '1' (local development).
 */
export function juryDevUi(): boolean {
  return process.env.NEXT_PUBLIC_JURY_DEV_UI === '1';
}
