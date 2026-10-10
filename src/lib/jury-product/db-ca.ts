import { X509Certificate } from 'node:crypto';

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
