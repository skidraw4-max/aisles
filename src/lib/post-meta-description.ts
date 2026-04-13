const META_DESC_MAX = 158;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 본문에서 URL·마크다운 느낌의 잡문자만 가볍게 정리 (SEO 스니펫용) */
function snippetFromBody(raw: string): string {
  let t = collapseWhitespace(raw);
  t = t.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  t = t.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  return collapseWhitespace(t);
}

type BuildMetaInput = {
  title: string;
  content: string | null | undefined;
  /** 예: Lab, Gallery — 메타 문장에만 사용 */
  categoryLabel?: string;
  siteName?: string;
};

/**
 * `<meta name="description">` / OG description — 제목·본문을 조합해 158자 내 스니펫.
 * 본문이 비거나 짧으면 복도·사이트 맥락을 붙인 고정 패턴으로 채움.
 */
export function buildPostMetaDescription(input: BuildMetaInput): string {
  const site = input.siteName ?? 'AIsle';
  const title = collapseWhitespace(input.title) || '게시글';
  const category = input.categoryLabel?.trim();
  const body = snippetFromBody(input.content ?? '');

  if (body.length >= 50) {
    const excerpt = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    let out = `${title}. ${excerpt}`;
    if (out.length <= META_DESC_MAX) return out;
    out = `${title} — ${excerpt}`;
    if (out.length <= META_DESC_MAX) return out;
    return `${out.slice(0, META_DESC_MAX - 1)}…`;
  }

  if (body.length > 0) {
    const merged = `${title}. ${body}`;
    if (merged.length <= META_DESC_MAX) return merged;
    return `${merged.slice(0, META_DESC_MAX - 1)}…`;
  }

  const tail = category
    ? `${category} 복도에서 공유된 글입니다. ${site}에서 AI 프롬프트·창작 레시피를 더 살펴보세요.`
    : `${site}에서 AI 프롬프트와 창작 레시피를 살펴보세요.`;
  const fallback = `${title} — ${tail}`;
  if (fallback.length <= META_DESC_MAX) return fallback;
  return `${fallback.slice(0, META_DESC_MAX - 1)}…`;
}
