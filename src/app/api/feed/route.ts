import { NextRequest, NextResponse } from 'next/server';
import { parseFeedExcludeIds } from '@/lib/feed-exclude';
import { parseHomeFeedSort } from '@/lib/feed-sort';
import { parseHomeCategoryQuery } from '@/lib/post-categories';
import {
  fetchFeaturedForHome,
  fetchFeedPosts,
  serializeFeedPost,
} from '@/lib/home-feed';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  if (url.searchParams.get('featured') === '1') {
    const category = parseHomeCategoryQuery(url.searchParams.get('category'));
    const posts = await fetchFeaturedForHome(category);
    return NextResponse.json({ posts: posts.map(serializeFeedPost) });
  }

  const sort = parseHomeFeedSort(url.searchParams.get('sort'));
  const skip = Math.max(0, parseInt(url.searchParams.get('skip') || '0', 10) || 0);
  const limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
  const category = parseHomeCategoryQuery(url.searchParams.get('category'));
  const excludeIds = parseFeedExcludeIds(url.searchParams.get('exclude'));

  const { posts, hasMore } = await fetchFeedPosts(sort, skip, limit, category, excludeIds);
  return NextResponse.json({ posts: posts.map(serializeFeedPost), hasMore });
}
