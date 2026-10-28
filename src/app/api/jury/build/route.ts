import { NextResponse } from 'next/server';
import { currentBuildVersion } from '@/lib/jury-product/build-version';

export const dynamic = 'force-dynamic';

/** I-098: current production build id (commit sha prefix only) for the /jury stale-tab notice. */
export function GET() {
  return NextResponse.json({ build: currentBuildVersion() }, { headers: { 'Cache-Control': 'no-store' } });
}
