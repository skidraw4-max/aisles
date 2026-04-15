import { createHash } from 'node:crypto';

/** DB 캐시 키용 — 동일 프롬프트면 동일 지문 */
export function fingerprintPrompt(text: string): string {
  return createHash('sha256').update(text.trim(), 'utf8').digest('hex');
}
