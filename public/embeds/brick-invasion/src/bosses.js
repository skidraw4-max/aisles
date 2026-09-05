/** Boss roster — cycles every boss stage (5, 10, 15, ...) */
export const BOSS_COUNT = 5;

export const BOSS_ROSTER = [
  { id: "hive", name: "Hive Node", clearTitle: "Hive 제압!", sprite: "boss0" },
  { id: "crystal", name: "Crystal Eye", clearTitle: "크리스탈 격파!", sprite: "boss1" },
  { id: "slugking", name: "Slug King", clearTitle: "슬러그 킹 격파!", sprite: "boss2" },
  { id: "beetle", name: "Beetle Queen", clearTitle: "비틀 퀸 격파!", sprite: "boss3" },
  { id: "starjelly", name: "Star Jelly", clearTitle: "스타 젤리 격파!", sprite: "boss4" },
];

/** Boss index for a boss stage number (5→0, 10→1, …, 30→0) */
export function bossIndexForStage(stage) {
  if (stage % 5 !== 0) return -1;
  return (Math.floor(stage / 5) - 1 + BOSS_COUNT * 100) % BOSS_COUNT;
}

export function getBossInfo(stage) {
  const idx = bossIndexForStage(stage);
  if (idx < 0) return null;
  return { ...BOSS_ROSTER[idx], index: idx };
}

/** Encode: 100 + type*1000 + hp */
export function encodeBoss(type, hp) {
  return 100 + type * 1000 + Math.max(1, hp | 0);
}

export function bossType(v) {
  if (v < 100) return -1;
  return Math.floor((v - 100) / 1000);
}

export function cellHp(v) {
  if (v >= 100) return (v - 100) % 1000;
  if (v > 0) return v;
  return 0;
}

export function isBossCell(v) {
  return v >= 100;
}
