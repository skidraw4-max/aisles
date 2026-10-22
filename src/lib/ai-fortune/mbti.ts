/** MBTI 16유형 (대문자 4글자) */
export const MBTI_TYPES = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
] as const;

export type MbtiType = (typeof MBTI_TYPES)[number];

const MBTI_SET = new Set<string>(MBTI_TYPES);

export function parseMbtiType(raw: unknown): MbtiType | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toUpperCase();
  return MBTI_SET.has(v) ? (v as MbtiType) : null;
}

export function isValidMbtiType(raw: string): raw is MbtiType {
  return parseMbtiType(raw) !== null;
}
