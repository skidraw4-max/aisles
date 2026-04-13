import { NextRequest, NextResponse } from 'next/server';
import { parseFeedExcludeIds } from '@/lib/feed-exclude';
import { parseHomeCategoryQuery } from '@/lib/post-categories';
import {
  fetchFeaturedForHome,
  fetchFeedPosts,
  serializeFeedPost,
} from '@/lib/home-feed';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    if (url.searchParams.get('featured') === '1') {
      const category = parseHomeCategoryQuery(url.searchParams.get('category'));
      const posts = await fetchFeaturedForHome(category);
      return NextResponse.json({ posts: posts.map(serializeFeedPost) });
    }

    const skip = Math.max(0, parseInt(url.searchParams.get('skip') || '0', 10) || 0);
    const limit = Math.min(24, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
    const category = parseHomeCategoryQuery(url.searchParams.get('category'));
    const excludeIds = parseFeedExcludeIds(url.searchParams.get('exclude'));
    const excludeCommunity = url.searchParams.get('excludeCommunity') === '1';

    const { posts, hasMore } = await fetchFeedPosts(skip, limit, category, excludeIds, {
      excludeLoungeGossipFromAll: excludeCommunity && category === null,
    });
    return NextResponse.json({ posts: posts.map(serializeFeedPost), hasMore });
  } catch (err) {
    console.error('[api/feed GET]', err);
    return NextResponse.json({ posts: [], hasMore: false }, { status: 200 });
  }
}
