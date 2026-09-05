/** Mulberry32 seeded RNG */
import { getBossInfo, encodeBoss, cellHp, isBossCell } from "./bosses.js";

export { cellHp, isBossCell, getBossInfo } from "./bosses.js";

export function createRng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const COLS = 9;
export const ROWS = 14;

/** Pickup cell codes: -10=+1, -20=+2, -50=+5 */
export const PICKUP = {
  PLUS1: -10,
  PLUS2: -20,
  PLUS5: -50,
};

/**
 * Difficulty curve:
 * - stages 1..100 ramp
 * - 101+ keep ramping gently forever
 */
export function getDifficulty(stage) {
  const s = Math.max(1, stage | 0);
  const cycle = ((s - 1) % 100) + 1;
  const loops = Math.floor((s - 1) / 100);
  const t = (cycle - 1) / 99;

  const fill = Math.min(0.82, 0.28 + t * 0.42 + loops * 0.03);
  const wallChance = Math.min(0.28, 0.06 + t * 0.16 + loops * 0.01);
  const hpBias = Math.min(2.4, 0.15 + t * 1.4 + loops * 0.15);
  const shots = Math.max(5, Math.round(14 - t * 6 - loops * 0.4));
  const bossHp = Math.round(22 + cycle * 1.4 + loops * 14);
  const pickupChance = Math.min(0.14, 0.045 + t * 0.07 + loops * 0.01);

  return { fill, wallChance, hpBias, shots, bossHp, pickupChance, cycle, loops };
}

function pickHp(rng, hpBias) {
  const roll = rng() + hpBias * 0.15;
  if (roll > 1.55) return 3;
  if (roll > 0.95) return 2;
  return 1;
}

function pickPickup(rng) {
  const r = rng();
  if (r < 0.12) return PICKUP.PLUS5;
  if (r < 0.42) return PICKUP.PLUS2;
  return PICKUP.PLUS1;
}

/**
 * Cell kinds:
 * 0 empty, -1 wall,
 * -10/+1 -20/+2 -50/+5 pickups,
 * 1..3 swarm HP, 100+ boss HP
 */
export function generateLevel(stage) {
  const rng = createRng(stage * 9973 + 42);
  const diff = getDifficulty(stage);
  const isBoss = stage % 5 === 0;
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

  for (let c = 0; c < COLS; c++) {
    if (c === 0 || c === COLS - 1) grid[0][c] = -1;
  }

  const usableRows = isBoss ? ROWS - 5 : ROWS - 4;
  for (let r = 1; r < usableRows; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r >= usableRows - 1 && (c === 3 || c === 4 || c === 5)) continue;

      const edge = c === 0 || c === COLS - 1;
      if (edge && rng() < 0.45 + diff.wallChance) {
        grid[r][c] = -1;
        continue;
      }

      if (rng() < diff.wallChance * (0.7 + (r / usableRows) * 0.6)) {
        if (rng() > 0.35) grid[r][c] = -1;
        continue;
      }

      if (rng() < diff.fill) {
        grid[r][c] = pickHp(rng, diff.hpBias);
      }
    }
  }

  // bounce pockets — keep at least one side open so we don't seal corridors
  for (let r = 2; r < Math.min(8, usableRows); r += 2) {
    const c = 1 + Math.floor(rng() * (COLS - 2));
    grid[r][c] = -1;
    if (c + 2 < COLS - 1 && rng() < 0.55) grid[r][c + 2] = -1;
  }

  // keep a clear vertical approach lane (never wall)
  const lane = 1 + Math.floor(rng() * (COLS - 2));
  for (let r = 0; r < ROWS; r++) {
    if (isWall(grid[r][lane])) grid[r][lane] = 0;
  }

  // bottom approach always open
  for (let r = usableRows; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) grid[r][c] = 0;
  }
  for (let c = 2; c <= 6; c++) {
    if (usableRows - 1 >= 0) grid[usableRows - 1][c] = 0;
  }

  if (isBoss) {
    const boss = getBossInfo(stage);
    const br = Math.min(4, usableRows - 1);
    const bc = 4;
    for (let r = br - 1; r <= br + 1; r++) {
      for (let c = bc - 1; c <= bc + 1; c++) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r][c] = 0;
      }
    }
    for (const [r, c] of [
      [br, bc - 2],
      [br, bc + 2],
      [br + 1, bc - 1],
      [br + 1, bc + 1],
    ]) {
      if (grid[r]?.[c] !== undefined) grid[r][c] = pickHp(rng, diff.hpBias + 0.4);
    }
    grid[br][bc] = encodeBoss(boss.index, diff.bossHp);

    const spots = [
      [br + 2, bc - 2],
      [br + 2, bc + 2],
      [br + 3, bc],
    ];
    for (const [r, c] of spots) {
      if (grid[r]?.[c] === 0) grid[r][c] = pickPickup(rng);
    }
  }

  let placed = 0;
  const t = (diff.cycle - 1) / 99;
  const want = isBoss ? 5 + Math.floor(t * 3) : 2 + Math.floor(t * 4);

  for (let attempt = 0; attempt < 80 && placed < want; attempt++) {
    const r = 1 + Math.floor(rng() * (usableRows - 1));
    const c = Math.floor(rng() * COLS);
    if (grid[r][c] !== 0) continue;
    if (rng() > diff.pickupChance * 8 && placed > 0) continue;
    grid[r][c] = pickPickup(rng);
    placed += 1;
  }

  if (placed === 0) {
    for (let r = usableRows - 2; r >= 1 && placed === 0; r--) {
      for (let c = 1; c < COLS - 1; c++) {
        if (grid[r][c] === 0) {
          grid[r][c] = PICKUP.PLUS1;
          placed = 1;
          break;
        }
      }
    }
  }

  let targets = countTargets(grid);
  if (targets < 6) {
    for (let i = 0; i < 8; i++) {
      const r = 1 + Math.floor(rng() * (usableRows - 1));
      const c = Math.floor(rng() * COLS);
      if (grid[r][c] === 0) grid[r][c] = pickHp(rng, diff.hpBias);
    }
  }

  // Remove sealed pockets / guarantee ball can reach every target
  ensureAllTargetsReachable(grid, rng, diff);

  const boss = isBoss ? getBossInfo(stage) : null;

  return {
    stage,
    isBoss,
    boss,
    shots: isBoss ? diff.shots + 3 : diff.shots,
    grid,
    name: boss ? `${boss.name} · S${stage}` : `Sector ${String(stage).padStart(2, "0")}`,
  };
}

/** 4-way flood fill from the bottom open area (ball entry). */
export function computeReachable(grid) {
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const q = [];

  for (let r = ROWS - 1; r >= Math.max(0, ROWS - 4); r--) {
    for (let c = 0; c < COLS; c++) {
      if (!isWall(grid[r][c]) && !seen[r][c]) {
        seen[r][c] = true;
        q.push(r, c);
      }
    }
  }

  // fallback seed if bottom somehow blocked
  if (q.length === 0) {
    const r = ROWS - 1;
    const c = (COLS / 2) | 0;
    grid[r][c] = 0;
    seen[r][c] = true;
    q.push(r, c);
  }

  const dirs = [1, 0, -1, 0, 1];
  while (q.length) {
    const r = q.shift();
    const c = q.shift();
    for (let i = 0; i < 4; i++) {
      const nr = r + dirs[i];
      const nc = c + dirs[i + 1];
      if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
      if (seen[nr][nc] || isWall(grid[nr][nc])) continue;
      seen[nr][nc] = true;
      q.push(nr, nc);
    }
  }
  return seen;
}

function carvePathTo(grid, tr, tc) {
  // clear a simple vertical then horizontal tunnel toward bottom center
  const bc = (COLS / 2) | 0;
  for (let r = tr; r < ROWS; r++) {
    if (isWall(grid[r][tc])) grid[r][tc] = 0;
  }
  const c0 = Math.min(tc, bc);
  const c1 = Math.max(tc, bc);
  const row = Math.min(ROWS - 1, Math.max(tr, ROWS - 3));
  for (let c = c0; c <= c1; c++) {
    if (isWall(grid[row][c])) grid[row][c] = 0;
  }
}

/**
 * - Drop unreachable targets/pickups
 * - If boss is sealed, carve a path
 * - Open walls that fully enclose a single neighbor pocket when cheap
 * - Refill targets only on reachable empty cells
 */
function ensureAllTargetsReachable(grid, rng, diff) {
  let reachable = computeReachable(grid);

  // Boss must be reachable — carve if sealed
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isBossCell(grid[r][c]) && !reachable[r][c]) {
        carvePathTo(grid, r, c);
      }
    }
  }

  reachable = computeReachable(grid);

  // Remove sealed swarm / pickups (unreachable from ball entry)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (reachable[r][c]) continue;
      const v = grid[r][c];
      if (v > 0 || isPickup(v)) grid[r][c] = 0;
    }
  }

  // Break tiny sealed empty pockets next to walls by opening one wall toward reachable space
  reachable = computeReachable(grid);
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      if (reachable[r][c] || isWall(grid[r][c])) continue;
      // unreachable non-wall leftover — open nearest wall toward bottom
      for (let rr = r + 1; rr < ROWS; rr++) {
        if (isWall(grid[rr][c])) {
          grid[rr][c] = 0;
          break;
        }
        if (reachable[rr]?.[c]) break;
      }
    }
  }

  reachable = computeReachable(grid);

  // Final sweep: never leave a target unreachable
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!reachable[r][c] && grid[r][c] > 0) grid[r][c] = 0;
    }
  }

  reachable = computeReachable(grid);
  let targets = countTargets(grid);
  if (targets < 6) {
    const empties = [];
    for (let r = 1; r < ROWS - 3; r++) {
      for (let c = 0; c < COLS; c++) {
        if (reachable[r][c] && grid[r][c] === 0) empties.push([r, c]);
      }
    }
    while (targets < 6 && empties.length) {
      const idx = Math.floor(rng() * empties.length);
      const [r, c] = empties.splice(idx, 1)[0];
      grid[r][c] = pickHp(rng, diff.hpBias);
      targets += 1;
    }
  }

  // Place at least one pickup on reachable cell if none remain
  let pickups = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) if (isPickup(grid[r][c])) pickups += 1;
  }
  if (pickups === 0) {
    reachable = computeReachable(grid);
    outer: for (let r = ROWS - 5; r >= 1; r--) {
      for (let c = 1; c < COLS - 1; c++) {
        if (reachable[r][c] && grid[r][c] === 0) {
          grid[r][c] = PICKUP.PLUS1;
          break outer;
        }
      }
    }
  }
}

export function countTargets(grid) {
  let n = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v > 0) n += 1;
    }
  }
  return n;
}

export function isWall(v) {
  return v === -1;
}

export function isTarget(v) {
  return v > 0;
}

export function isPickup(v) {
  return v === PICKUP.PLUS1 || v === PICKUP.PLUS2 || v === PICKUP.PLUS5;
}

export function pickupAmount(v) {
  if (v === PICKUP.PLUS5) return 5;
  if (v === PICKUP.PLUS2) return 2;
  if (v === PICKUP.PLUS1) return 1;
  return 0;
}
