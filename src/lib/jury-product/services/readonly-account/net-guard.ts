/**
 * I-057: private-network / metadata protection for the READ_ONLY_ACCOUNT browser.
 * - Hostname rules (no DNS): IP literals, localhost, *.local/*.internal/*.localhost, single-label names, cloud metadata names.
 * - Resolved-address rules: every A/AAAA answer must be public. Checked per host before a request is let through
 *   (cached per run). Chromium resolves again on its own, so a hostile DNS server could still rebind between the
 *   check and the connection; the hostname rules and the https-only origin allowlist remain the primary defence.
 */
import { isIP } from 'node:net';

const METADATA_HOSTS = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp'];

function v4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const n = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return n.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? n : null;
}

/** true for loopback, private, link-local (incl. 169.254.169.254), CGNAT, multicast, reserved and unspecified ranges. */
export function isNonPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = v4(ip)!;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNonPublicAddress(mapped[1]);
    if (/^::ffff:/.test(s)) return true;
    const head = parseInt(s.split(':')[0] || '0', 16);
    return (
      (head & 0xfe00) === 0xfc00 || // fc00::/7 unique local
      (head & 0xffc0) === 0xfe80 || // fe80::/10 link local
      (head & 0xff00) === 0xff00 || // multicast
      s.startsWith('64:ff9b:') || s.startsWith('2001:db8:') || s.startsWith('fd00:ec2::')
    );
  }
  return true;
}

/** Hostname-only check (no DNS). IP literals are never allowed as observation targets. */
export function isForbiddenHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (isIP(h)) return true;
  if (h === 'localhost' || METADATA_HOSTS.has(h)) return true;
  if (!h.includes('.')) return true;
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

export type HostLookup = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: HostLookup = async (hostname) => {
  const { lookup } = await import('node:dns/promises');
  return lookup(hostname, { all: true, verbatim: true });
};

/** Per-run cached check: hostname rules first, then every resolved address must be public. Fails closed. */
export function createHostCheck(lookup: HostLookup = defaultLookup): { check(hostname: string): Promise<boolean>; denied: () => number } {
  const cache = new Map<string, Promise<boolean>>();
  let deniedCount = 0;
  const evaluate = async (h: string) => {
    if (isForbiddenHostname(h)) return false;
    try {
      const answers = await lookup(h);
      return answers.length > 0 && answers.every((a) => !isNonPublicAddress(a.address));
    } catch {
      return false;
    }
  };
  return {
    async check(hostname) {
      const h = hostname.toLowerCase();
      let p = cache.get(h);
      if (!p) {
        p = evaluate(h);
        cache.set(h, p);
      }
      const ok = await p;
      if (!ok) deniedCount += 1;
      return ok;
    },
    denied: () => deniedCount,
  };
}
