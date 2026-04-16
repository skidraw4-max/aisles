/**
 * 두 프롬프트 문자열의 유사도를 0–100점으로 추정 (바이그램 Dice 계수 + 정규화).
 * 한글·영문 혼용에 대해 공백·대소문자 차이를 줄입니다.
 */
export function computePromptSyncPercent(original: string, ai: string): number {
  const a = original.trim();
  const b = ai.trim();
  if (!a && !b) return 100;
  if (!a || !b) return 0;

  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na === nb) return 100;
  if (na.length < 2 && nb.length < 2) return na === nb ? 100 : 0;

  const bigrams = (s: string): string[] => {
    if (s.length <= 1) return [s];
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) {
      out.push(s.slice(i, i + 2));
    }
    return out;
  };

  const A = bigrams(na);
  const B = bigrams(nb);
  const mapB = new Map<string, number>();
  for (const x of B) {
    mapB.set(x, (mapB.get(x) ?? 0) + 1);
  }
  let inter = 0;
  for (const x of A) {
    const c = mapB.get(x);
    if (c && c > 0) {
      inter++;
      mapB.set(x, c - 1);
    }
  }
  const denom = A.length + B.length;
  const dice = denom === 0 ? 0 : (2 * inter) / denom;
  return Math.min(100, Math.max(0, Math.round(dice * 100)));
}

function normalizeForCompare(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function promptSyncFunLabel(score: number): { label: string; emoji: string } {
  if (score >= 85) return { label: '찰떡궁합', emoji: '✨' };
  if (score >= 65) return { label: '꽤 잘 맞아요', emoji: '👍' };
  if (score >= 40) return { label: '비슷한 느낌', emoji: '🔀' };
  if (score >= 15) return { label: '조금 다른 길', emoji: '🌀' };
  return { label: '우주 다른 느낌', emoji: '🛸' };
}
