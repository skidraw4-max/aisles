const META_DESC_MAX = 158;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 본문에서 URL·마크다운 느낌의 잡문자만 가볍게 정리 (SEO 스니펫용) */
function snippetFromBody(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = collapseWhitespace(t);
  t = t.replace(/!\[[^\]]*]\([^)]+\)/g, ' ');
  t = t.replace(/\[([^\]]+)]\([^)]+\)/g, '$1');
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  return collapseWhitespace(t);
}

/** 스니펫을 예산 길이 안에서 잘라 문장 경계를 우선한다. */
function excerptAtBudget(text: string, maxLen: number): string {
  if (maxLen < 20) return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= maxLen) return trimmed;

  const slice = trimmed.slice(0, maxLen - 1);
  const dotSpace = slice.lastIndexOf('. ');
  const qSpace = slice.lastIndexOf('? ');
  const bangSpace = slice.lastIndexOf('! ');
  const newline = slice.lastIndexOf('\n');
  const ideographicFullStop = slice.lastIndexOf('。');
  const best = Math.max(dotSpace, qSpace, bangSpace, newline, ideographicFullStop);

  const minCut = Math.min(24, Math.floor(slice.length * 0.35));
  if (best >= minCut) {
    if (newline === best) return slice.slice(0, best).trim();
    if (ideographicFullStop === best) return slice.slice(0, best + 1).trim();
    return slice.slice(0, best + 1).trim();
  }

  return `${slice.trim()}…`;
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
  let body = snippetFromBody(input.content ?? '');

  const titleSentence = `${title}.`;
  const sep = ' ';
  /** 제목 한 문장 뒤 본문 스니펫에 쓸 남은 글자 수 */
  const budgetAfterTitle = META_DESC_MAX - titleSentence.length - sep.length;

  if (body.length >= 50) {
    let excerptSource = body;
    const probe = title.slice(0, Math.min(36, title.length));
    if (probe.length >= 12 && excerptSource.startsWith(probe)) {
      excerptSource = excerptSource.slice(probe.length).replace(/^[\s.:·\-—|]+/, '').trim();
    }
    const excerpt = excerptAtBudget(excerptSource, Math.max(48, budgetAfterTitle));
    let out = `${titleSentence}${sep}${excerpt}`;
    if (out.length <= META_DESC_MAX) return out;
    out = `${title} — ${excerpt}`;
    if (out.length <= META_DESC_MAX) return out;
    return `${out.slice(0, META_DESC_MAX - 1)}…`;
  }

  if (body.length > 0) {
    const excerpt = excerptAtBudget(body, Math.max(28, budgetAfterTitle));
    const merged = `${titleSentence}${sep}${excerpt}`;
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
