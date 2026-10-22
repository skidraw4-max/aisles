/**
 * Node용 youtube-transcript (자막). Python `youtube-transcript-api`와 유사한 역할.
 * 한국어 트랙 우선 → 없으면 영어 등 첫 가용 트랙.
 */
import { YoutubeTranscript } from 'youtube-transcript';

export type TranscriptResult = {
  text: string;
  /** 대표 언어 코드 (예: ko, en) */
  lang: string;
  /** 한국어 자막을 직접 썼는지 */
  isKoreanPrimary: boolean;
};

const KO_PREFIXES = ['ko', 'ko-KR'];

function joinTranscript(items: { text: string }[]): string {
  return items
    .map((x) => x.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchYoutubeTranscriptPreferKorean(videoId: string): Promise<TranscriptResult | null> {
  const tryLangs = ['ko', 'ko-KR', 'en', 'en-US', 'en-GB'];

  for (const lang of tryLangs) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang });
      const text = joinTranscript(items);
      if (text.length < 80) continue;
      const isKo = KO_PREFIXES.some((p) => lang.startsWith('ko'));
      return {
        text,
        lang,
        isKoreanPrimary: isKo,
      };
    } catch {
      /* try next */
    }
  }

  try {
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    const text = joinTranscript(items);
    if (text.length < 80) return null;
    const lang = (items[0] as { lang?: string })?.lang ?? 'unknown';
    const isKo = typeof lang === 'string' && lang.toLowerCase().startsWith('ko');
    return { text, lang, isKoreanPrimary: isKo };
  } catch {
    return null;
  }
}
