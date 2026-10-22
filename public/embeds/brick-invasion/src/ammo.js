/** Ammo types — unlock thresholds are ~2x the earlier proposal */
export const AMMO_TYPES = [
  {
    id: "plasma",
    name: "플라즈마",
    unlockAt: 0,
    color: "#7af0ff",
    glow: "rgba(122,240,255,0.55)",
    speed: 760,
    radiusScale: 1,
    damage: 1,
    volleyScale: 1,
  },
  {
    id: "split",
    name: "스플릿",
    unlockAt: 20,
    color: "#ff7eb3",
    glow: "rgba(255,126,179,0.55)",
    speed: 720,
    radiusScale: 0.92,
    damage: 1,
    volleyScale: 1,
  },
  {
    id: "heavy",
    name: "헤비",
    unlockAt: 50,
    color: "#ffb35a",
    glow: "rgba(255,179,90,0.55)",
    speed: 520,
    radiusScale: 1.35,
    damage: 2,
    volleyScale: 0.55,
  },
  {
    id: "drill",
    name: "드릴",
    unlockAt: 100,
    color: "#9dff5c",
    glow: "rgba(157,255,92,0.55)",
    speed: 800,
    radiusScale: 0.95,
    damage: 1,
    volleyScale: 1,
  },
];

export function ammoById(id) {
  return AMMO_TYPES.find((a) => a.id === id) || AMMO_TYPES[0];
}

export function unlockedAmmoIds(bestStageCleared) {
  const best = Math.max(0, bestStageCleared | 0);
  return AMMO_TYPES.filter((a) => best >= a.unlockAt).map((a) => a.id);
}

/** Newly unlocked when best goes from `prevBest` to `nextBest` (inclusive clear). */
export function newlyUnlockedAmmo(prevBest, nextBest) {
  return AMMO_TYPES.filter((a) => a.unlockAt > 0 && prevBest < a.unlockAt && nextBest >= a.unlockAt);
}
