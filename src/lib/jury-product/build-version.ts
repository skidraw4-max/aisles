/**
 * I-098: short build id of the deployment serving this request (public commit sha prefix, not a secret).
 * Used to tell a stale /jury tab that a newer deployment is live.
 */
export function currentBuildVersion(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : 'local';
}

/** True when both builds are known and differ. */
export function isStaleBuild(client: string | null | undefined, server: string | null | undefined): boolean {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{7}$/.test(v);
  return ok(client) && ok(server) && client !== server;
}
