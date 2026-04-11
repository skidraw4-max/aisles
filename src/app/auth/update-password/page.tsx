import { redirect } from 'next/navigation';

/** 예전 메일·북마크 호환: 공개 재설정 경로로 통일 */
export default function LegacyUpdatePasswordRedirect() {
  redirect('/auth/reset-password');
}
