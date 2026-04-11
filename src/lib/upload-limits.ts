/**
 * `/api/posts/upload-image` 등 **서버리스 함수 본문**으로 파일을 보낼 때의 상한.
 * Vercel은 약 4.5MB를 넘기면 라우트 실행 전 413과 plain text(예: Request Entity Too Large)를 반환하고,
 * 클라이언트가 `res.json()`만 호출하면 JSON 파싱 오류가 납니다.
 *
 * 기본값 4MB — Vercel 한도에 맞춤.
 * 자체 호스팅 등에서 본문 한도가 더 크면 `.env`에 `NEXT_PUBLIC_MAX_UPLOAD_MB` 로 MB 단위 지정 (1~100).
 * 그래도 Vercel에 배포할 때는 4~4.5MB를 넘기면 플랫폼에서 먼저 거절됩니다.
 */
function resolveUploadMaxBytes(): number {
  const raw = process.env.NEXT_PUBLIC_MAX_UPLOAD_MB?.trim();
  if (raw) {
    const mb = parseInt(raw, 10);
    if (!Number.isNaN(mb) && mb >= 1 && mb <= 100) {
      return mb * 1024 * 1024;
    }
  }
  return 4 * 1024 * 1024;
}

export const UPLOAD_IMAGE_MAX_BYTES = resolveUploadMaxBytes();

export function formatUploadMaxSizeLabel(): string {
  const mb = UPLOAD_IMAGE_MAX_BYTES / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}
