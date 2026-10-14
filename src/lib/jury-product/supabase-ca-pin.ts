/**
 * Pinned identity of the Supabase root CA committed at certs/supabase/prod-ca-2021.crt.
 * Source: Supabase dashboard > Database Settings > SSL Configuration > Download certificate
 * (see certs/supabase/README.md). Public certificate metadata only; no secrets.
 * Rotation: re-download, compare, then update these values, the file, and the README together.
 */
export type CaPin = {
  /** SHA-256 of the exact file bytes, lowercase hex. */
  fileSha256: string;
  /** SHA-256 of the DER certificate, as node:crypto X509Certificate.fingerprint256 reports it. */
  fingerprint256: string;
  /** Distinguished names exactly as X509Certificate.subject / .issuer report them. */
  subject: string;
  issuer: string;
  /** ISO-8601 UTC validity bounds. */
  validFrom: string;
  validTo: string;
};

export const SUPABASE_CA_RELATIVE_PATH = 'certs/supabase/prod-ca-2021.crt';

const SUPABASE_ROOT_2021_DN = 'C=US\nST=Delware\nL=New Castle\nO=Supabase Inc\nCN=Supabase Root 2021 CA';

export const SUPABASE_CA_PIN: Readonly<CaPin> = Object.freeze({
  fileSha256: '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7',
  fingerprint256:
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  subject: SUPABASE_ROOT_2021_DN,
  issuer: SUPABASE_ROOT_2021_DN,
  validFrom: '2021-04-28T10:56:53.000Z',
  validTo: '2031-04-26T10:56:53.000Z',
});