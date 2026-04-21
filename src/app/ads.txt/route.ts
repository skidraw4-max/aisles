import { NextResponse } from 'next/server';

/**
 * Google AdSense ads.txt — AdSense 대시보드에 표시된 전체 내용을 환경 변수 ADS_TXT 로 넣습니다.
 * (저장소에 pub ID 를 커밋하지 않기 위함)
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const raw = process.env.ADS_TXT?.trim();
  if (!raw) {
    return new NextResponse(null, { status: 404 });
  }

  const body = raw.endsWith('\n') ? raw : `${raw}\n`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
