import { applyRecharge, MAX_PLAYS } from "./energy.js";

const KEY = "brickinvasion.save.v4";

const defaults = () => ({
  bestStage: 1,
  bestCleared: 0,
  bestScore: 0,
  resumeStage: 1,
  ballCount: 1,
  selectedAmmo: "plasma",
  plays: MAX_PLAYS,
  playsUpdatedAt: Date.now(),
  runSectorsCleared: 0,
  inRun: false,
});

function readRaw() {
  return (
    localStorage.getItem(KEY) ||
    localStorage.getItem("brickinvasion.save.v3") ||
    localStorage.getItem("brickinvasion.save.v2") ||
    localStorage.getItem("brickinvasion.save.v1")
  );
}

function normalize(data) {
  const bestStage = Number(data.bestStage) || 1;
  const bestCleared = Math.max(
    0,
    Number(data.bestCleared ?? (data.bestStage != null ? bestStage : 0)) || 0
  );
  return {
    bestStage,
    bestCleared,
    bestScore: Number(data.bestScore) || 0,
    resumeStage: Number(data.resumeStage) || 1,
    ballCount: Math.max(1, Number(data.ballCount) || 1),
    selectedAmmo: data.selectedAmmo || "plasma",
    plays: data.plays != null ? Number(data.plays) : MAX_PLAYS,
    playsUpdatedAt: Number(data.playsUpdatedAt) || Date.now(),
    runSectorsCleared: Math.max(0, Number(data.runSectorsCleared) || 0),
    inRun: Boolean(data.inRun),
  };
}

function persist(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

export function loadSave() {
  try {
    const raw = readRaw();
    if (!raw) return defaults();
    const base = normalize(JSON.parse(raw));
    const ticked = applyRecharge(base);
    const next = { ...base, ...ticked };
    if (next.plays !== base.plays || next.playsUpdatedAt !== base.playsUpdatedAt) {
      persist(next);
    }
    return next;
  } catch {
    return defaults();
  }
}

export function saveProgress({
  stage,
  score,
  bestStage,
  bestCleared,
  bestScore,
  ballCount,
  selectedAmmo,
  plays,
  playsUpdatedAt,
  runSectorsCleared,
  inRun,
}) {
  const prev = loadSave();
  const next = {
    bestStage: Math.max(prev.bestStage, bestStage ?? stage ?? 1),
    bestCleared: Math.max(prev.bestCleared || 0, bestCleared ?? 0),
    bestScore: Math.max(prev.bestScore, bestScore ?? score ?? 0),
    resumeStage: Math.max(1, stage ?? prev.resumeStage),
    ballCount: Math.max(1, ballCount ?? prev.ballCount ?? 1),
    selectedAmmo: selectedAmmo ?? prev.selectedAmmo ?? "plasma",
    plays: plays ?? prev.plays,
    playsUpdatedAt: playsUpdatedAt ?? prev.playsUpdatedAt,
    runSectorsCleared: runSectorsCleared ?? prev.runSectorsCleared ?? 0,
    inRun: inRun ?? prev.inRun ?? false,
  };
  persist(next);
  return next;
}

/** Patch energy / deployment fields only. */
export function saveEnergy(patch) {
  const prev = loadSave();
  const next = { ...prev, ...patch };
  persist(next);
  return next;
}
