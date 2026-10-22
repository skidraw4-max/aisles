export const MAX_PLAYS = 5;
export const MAX_SECTORS_PER_RUN = 5;
export const RECHARGE_MS = 5 * 60 * 1000;

export function formatRecharge(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Apply offline/ elapsed recharge; does not consume. */
export function applyRecharge(data) {
  let plays = Math.max(0, Math.min(MAX_PLAYS, Number(data.plays ?? MAX_PLAYS) || 0));
  let playsUpdatedAt = Number(data.playsUpdatedAt) || Date.now();
  const now = Date.now();

  if (plays >= MAX_PLAYS) {
    return { plays: MAX_PLAYS, playsUpdatedAt: now };
  }

  const gained = Math.floor((now - playsUpdatedAt) / RECHARGE_MS);
  if (gained > 0) {
    plays = Math.min(MAX_PLAYS, plays + gained);
    playsUpdatedAt += gained * RECHARGE_MS;
    if (plays >= MAX_PLAYS) playsUpdatedAt = now;
  }

  return { plays, playsUpdatedAt };
}

export function getEnergyState(data) {
  const { plays, playsUpdatedAt } = applyRecharge(data);
  const full = plays >= MAX_PLAYS;
  let nextRechargeMs = 0;
  if (!full) {
    nextRechargeMs = RECHARGE_MS - (Date.now() - playsUpdatedAt);
    if (nextRechargeMs < 0) nextRechargeMs = 0;
  }
  return {
    plays,
    max: MAX_PLAYS,
    full,
    nextRechargeMs,
    nextRechargeLabel: full ? null : formatRecharge(nextRechargeMs),
    runSectorsCleared: Math.max(0, Number(data.runSectorsCleared) || 0),
    inRun: Boolean(data.inRun),
  };
}

export function canStartPlay(data) {
  return getEnergyState(data).plays >= 1;
}

export function canNextSector(data) {
  return getEnergyState(data).runSectorsCleared < MAX_SECTORS_PER_RUN;
}

/** Spend one deployment slot when entering from title / retry / continue. */
export function consumePlay(data) {
  const recharged = applyRecharge(data);
  if (recharged.plays < 1) return null;
  return {
    ...recharged,
    plays: recharged.plays - 1,
    runSectorsCleared: 0,
    inRun: true,
  };
}

export function onSectorCleared(data) {
  const cleared = Math.min(
    MAX_SECTORS_PER_RUN,
    Math.max(0, Number(data.runSectorsCleared) || 0) + 1
  );
  return { ...data, runSectorsCleared: cleared };
}

export function endDeployment(data) {
  return {
    ...data,
    inRun: false,
    runSectorsCleared: 0,
  };
}
