/**
 * I-060: masked screenshot storage. Private Supabase Storage bucket (no public URL, no anon/authenticated policies:
 * only the server's service role reads/writes). Keys are tenant-scoped and content-addressed; no path or text in keys.
 */
import { createHash } from 'node:crypto';
import type { AuditCapture, CaptureRef } from './audit-hook';
import type { ObservationDriver } from '../readonly-account/executor';

export const SCREENSHOT_BUCKET = 'jury-audit-screens';
export const SCREENSHOT_RETENTION_DAYS = 14;
export const SCREENSHOT_MAX_BYTES = 1_500_000;

export interface ScreenshotSink {
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

export function screenshotKey(tenantId: string, auditId: string, sha256: string): string {
  if (!/^[\w-]+$/.test(tenantId) || !/^[\w-]+$/.test(auditId) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('invalid screenshot key part');
  return `${tenantId}/${auditId}/${sha256}.jpg`;
}

export function screenshotExpiry(now: Date): Date {
  return new Date(now.getTime() + SCREENSHOT_RETENTION_DAYS * 86_400_000);
}

/** Capture = driver masks, shoots, unmasks. No capture is stored when masking could not be verified. */
export function createMaskedCapture(input: { driver: ObservationDriver; sink: ScreenshotSink; tenantId: string; auditId: string }): AuditCapture {
  return async ({ viewport }) => {
    if (!input.driver.captureMasked) return null;
    const shot = await input.driver.captureMasked();
    if (!shot || !shot.masked || shot.bytes.byteLength === 0 || shot.bytes.byteLength > SCREENSHOT_MAX_BYTES) return null;
    const sha256 = createHash('sha256').update(shot.bytes).digest('hex');
    const storageKey = screenshotKey(input.tenantId, input.auditId, sha256);
    await input.sink.put(storageKey, shot.bytes);
    const ref: CaptureRef = { storageKey, sha256, byteSize: shot.bytes.byteLength, width: viewport.width, height: viewport.height, masked: true, maskedCount: shot.maskedCount };
    return ref;
  };
}

export async function createSupabaseScreenshotSink(): Promise<ScreenshotSink> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const bucket = createAdminClient().storage.from(SCREENSHOT_BUCKET);
  return {
    async put(key, bytes) {
      const { error } = await bucket.upload(key, bytes, { contentType: 'image/jpeg', upsert: false });
      if (error && !/exists/i.test(error.message)) throw new Error('screenshot upload failed');
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const { error } = await bucket.remove(keys);
      if (error) throw new Error('screenshot remove failed');
    },
  };
}

/** Short-lived signed URL for the owner's UI (server side only, after tenant check). */
export async function signedScreenshotUrl(key: string, seconds = 300): Promise<string | null> {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  const { data, error } = await createAdminClient().storage.from(SCREENSHOT_BUCKET).createSignedUrl(key, seconds);
  return error || !data ? null : data.signedUrl;
}
