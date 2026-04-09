import { redirect } from 'next/navigation';

/** 글쓰기는 /upload 로 통합 */
export default function WriteRedirectPage() {
  redirect('/upload');
}
