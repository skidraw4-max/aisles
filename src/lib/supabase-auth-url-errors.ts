/**
 * Supabase 이메일 링크(verify/recovery) 만료·무효 시 Site URL로 붙는 쿼리/해시 판별.
 */

export function isSupabaseAuthLinkError(params: URLSearchParams): boolean {
  const code = params.get('error_code');
  if (code === 'otp_expired') return true;
  const err = params.get('error');
  if (err === 'access_denied' && code === 'otp_expired') return true;
  const desc = (params.get('error_description') || '').toLowerCase();
  if (desc.includes('expired') || desc.includes('invalid')) return true;
  return false;
}

export function formatSupabaseAuthErrorDescription(raw: string | null): string {
  if (!raw) return '이메일 링크가 만료되었거나 유효하지 않습니다.';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    decoded = raw.replace(/\+/g, ' ');
  }
  const lower = decoded.toLowerCase();
  if (lower.includes('expired') || lower.includes('invalid')) {
    return '이메일 링크가 만료되었거나 유효하지 않습니다.';
  }
  return decoded;
}
