/**
 * I-031: claim length as the server will count it (normalizeReviewClaim in records.ts).
 *
 * Server rule: String.prototype.trim() then .length (UTF-16 code units) ≤ JURY_CLAIM_MAX_LENGTH.
 * The browser submits textarea line breaks as CRLF, so each line break counts as 2 here, while the
 * textarea's own maxlength counts it as 1. Emoji outside the BMP count as 2 in both.
 */
import { JURY_CLAIM_MAX_LENGTH } from './records';

export function claimLengthForServer(value: string): number {
  return value.replace(/\r\n|\r|\n/g, '\r\n').trim().length;
}

export function claimLengthState(value: string): { length: number; max: number; tooLong: boolean; blank: boolean } {
  const length = claimLengthForServer(value);
  return { length, max: JURY_CLAIM_MAX_LENGTH, tooLong: length > JURY_CLAIM_MAX_LENGTH, blank: length === 0 };
}
