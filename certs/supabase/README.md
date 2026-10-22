# Supabase Root CA (pinned)

`prod-ca-2021.crt` is the Supabase Postgres root CA used for strict TLS (verify chain + hostname).

## Source
- Supabase dashboard > Database Settings > SSL Configuration > Download certificate
- Project: Preview project (ref intentionally omitted)
- Downloaded: 2026-10-10 ~20:47 KST; file copied byte-identical (SHA-256 re-verified on the developer PC)

## Certificate
- Subject = Issuer: C=US, ST=Delware, L=New Castle, O=Supabase Inc, CN=Supabase Root 2021 CA (self-signed root)
- Validity: 2021-04-28T10:56:53Z .. 2031-04-26T10:56:53Z
- basicConstraints: CA:TRUE (critical); RSA 2048
- File SHA-256: 700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7 (1367 bytes)
- Cert SHA-256 fingerprint: 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA

Matching fingerprints prove the file is unchanged, not independent provenance; the source is the authenticated dashboard download above.

## Pinned test
`src/lib/jury-product/supabase-ca.test.ts` fails if this file is missing, modified, or no longer a valid CA.

## Rotation procedure
1. Re-download from the dashboard path above (do not use third-party mirrors).
2. Compute file SHA-256 and cert fingerprint; compare against any announcement and an independent second download.
3. Replace the file (keep old+new bundled during overlap if Supabase rotates), update pinned values in the test and this README.
4. Review in a PR; never weaken TLS to work around a mismatch. Expiry 2031-04-26: start rotation well before.
