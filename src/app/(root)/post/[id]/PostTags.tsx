import Link from 'next/link';

type Props = {
  tags: string[];
};

/** 게시글 본문 하단 태그 배지 (# 접두사) — 클릭 시 `/search?tag=…`로 동일 태그 글 모아 보기 */
export function PostTags({ tags }: Props) {
  const list = tags.map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) return null;

  return (
    <div className="mt-8 flex flex-wrap gap-2" aria-label="태그">
      {list.map((tag, i) => (
        <Link
          key={`${tag}-${i}`}
          href={`/search?tag=${encodeURIComponent(tag)}`}
          className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2"
        >
          #{tag}
        </Link>
      ))}
    </div>
  );
}
