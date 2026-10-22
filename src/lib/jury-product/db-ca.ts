import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SUPABASE_CA_PIN, type CaPin } from './supabase-ca-pin';

/**
 * Shared CA check for database TLS. Returns the PEM only when the file is readable,
 * is a PEM certificate, is a CA (basicConstraints CA:TRUE), and is inside its
 * validity window. Never throws and never returns path or content details on failure.
 */
export function readValidCaPem(
  caPath: string,
  readFile: (file: string) => string,
  now: () => number = Date.now,
): string | null {
  let pem: string;
  try {
    pem = readFile(caPath);
  } catch {
    return null;
  }
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) return null;
  try {
    const cert = new X509Certificate(pem);
    if (!cert.ca) return null;
    const at = now();
    if (Date.parse(cert.validFrom) > at || Date.parse(cert.validTo) < at) return null;
  } catch {
    return null;
  }
  return pem;
}

/** Fixed failure codes for readPinnedCaPem. Safe to log: no path, PEM, or certificate content. */
export type PinnedCaErrorCode =
  | 'CA_PIN_MISSING'
  | 'CA_PIN_FILE_HASH'
  | 'CA_PIN_PARSE'
  | 'CA_PIN_FINGERPRINT'
  | 'CA_PIN_SUBJECT'
  | 'CA_PIN_ISSUER'
  | 'CA_PIN_NOT_CA'
  | 'CA_PIN_VALIDITY_MISMATCH'
  | 'CA_PIN_NOT_YET_VALID'
  | 'CA_PIN_EXPIRED';

export class PinnedCaError extends Error {
  readonly code: PinnedCaErrorCode;
  constructor(code: PinnedCaErrorCode) {
    super(code);
    this.name = 'PinnedCaError';
    this.code = code;
  }
}

export type ReadPinnedCaOptions = {
  pin?: CaPin;
  now?: () => number;
  fs?: { readFileSync: (file: string) => Buffer };
};

/**
 * Reads a CA file and accepts it only if it matches the pin exactly: file bytes
 * (SHA-256), DER fingerprint, subject, issuer, CA flag, pinned validity bounds,
 * and the current time inside that window. Returns the PEM text; throws
 * PinnedCaError with a fixed code otherwise. Never echoes path or content.
 */
export function readPinnedCaPem(caPath: string, opts: ReadPinnedCaOptions = {}): string {
  const pin = opts.pin ?? SUPABASE_CA_PIN;
  const now = opts.now ?? Date.now;
  const read = opts.fs?.readFileSync ?? ((file: string) => readFileSync(file));
  let bytes: Buffer;
  try {
    bytes = read(caPath);
  } catch {
    throw new PinnedCaError('CA_PIN_MISSING');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== pin.fileSha256.toLowerCase()) {
    throw new PinnedCaError('CA_PIN_FILE_HASH');
  }
  const pem = bytes.toString('utf8');
  let cert: X509Certificate;
  try {
    if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error('x');
    cert = new X509Certificate(pem);
  } catch {
    throw new PinnedCaError('CA_PIN_PARSE');
  }
  if (cert.fingerprint256.toUpperCase() !== pin.fingerprint256.toUpperCase()) throw new PinnedCaError('CA_PIN_FINGERPRINT');
  if (cert.subject !== pin.subject) throw new PinnedCaError('CA_PIN_SUBJECT');
  if (cert.issuer !== pin.issuer) throw new PinnedCaError('CA_PIN_ISSUER');
  if (!cert.ca) throw new PinnedCaError('CA_PIN_NOT_CA');
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (from !== Date.parse(pin.validFrom) || to !== Date.parse(pin.validTo)) {
    throw new PinnedCaError('CA_PIN_VALIDITY_MISMATCH');
  }
  const at = now();
  if (at < from) throw new PinnedCaError('CA_PIN_NOT_YET_VALID');
  if (at > to) throw new PinnedCaError('CA_PIN_EXPIRED');
  return pem;
}
