import {
  COLS,
  ROWS,
  generateLevel,
  countTargets,
  cellHp,
  isBossCell,
  isWall,
  isTarget,
  isPickup,
  pickupAmount,
} from "./levelgen.js";
import { encodeBoss, bossType } from "./bosses.js";
import { spriteForCell } from "./sprites.js";
import { audio } from "./audio.js";
import { AMMO_TYPES, ammoById, unlockedAmmoIds } from "./ammo.js";

const W = 720;
const H = 1280;
const HUD_H = 96;
const FOOT_H = 220;
const BOARD_PAD = 28;

const FIRE_GAP = 0.055;
const MAX_BALL_COUNT = 100;
const MAX_ACTIVE_BALLS = 140;
const BALL_LIFE = 7.5;
const MAX_BOUNCES = 90;
/** Fixed volley count per sector (each tap = one multi-ball volley). */
const SHOTS_PER_STAGE = 5;

/** Aim-arm mockup calibration (50% of tuned mockup size) */
const HERO_CAL = {
  bodyScale: 0.175,
  armScale: 0.125,
  shoulderX: 0.83,
  shoulderY: 0.51,
  armPivotX: 0.56,
  armPivotY: 0.92,
  muzzleLen: 106,
  angleOffsetDeg: -40,
  bottomPad: 70,
};

/** Guide / fire sweep: 5° … 175° (0° = right, CCW, y-up → canvas atan2 is negated) */
const AIM_MIN = (-175 * Math.PI) / 180;
const AIM_MAX = (-5 * Math.PI) / 180;

export class Game {
  constructor(canvas, sprites, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.sprites = sprites;
    this.hooks = hooks;

    this.stage = 1;
    this.score = 0;
    this.kills = 0;
    this.running = false;
    this.aimAngle = -Math.PI / 2;
    this.pointerDown = false;

    /** @type {Array<{x:number,y:number,vx:number,vy:number,r:number,hitCooldown:number,life:number,bounces:number}>} */
    this.balls = [];
    this.pendingToFire = 0;
    this.fireCooldown = 0;
    this.volleyAngle = -Math.PI / 2;

    this.level = null;
    this.shots = 0;
    this.ballCount = 1;
    this.ballCountAtStageStart = 1;
    this._stageClearing = false;
    this.selectedAmmo = "plasma";
    this.bestStageCleared = 0;
    this._tapLoadout = false;
    this.fx = [];

    this.cellSize = 0;
    this.board = { x: 0, y: 0, w: 0, h: 0 };
    this.cannon = { x: W / 2, y: H - 130 };

    this._bindInput();
    this._raf = 0;
    this._last = 0;
    this._loopAlive = false;
  }

  start(stage = 1, { keepScore = false, ballCount = 1, selectedAmmo = "plasma", bestStageCleared = 0 } = {}) {
    if (!keepScore) this.score = 0;
    this.ballCount = Math.max(1, Math.min(MAX_BALL_COUNT, ballCount | 0));
    this.bestStageCleared = Math.max(0, bestStageCleared | 0);
    const unlocked = unlockedAmmoIds(this.bestStageCleared);
    this.selectedAmmo = unlocked.includes(selectedAmmo) ? selectedAmmo : "plasma";
    this.stage = Math.max(1, stage | 0);
    this.loadStage(this.stage);
    this.running = true;
    this._ensureLoop();
  }

  nextStage() {
    this.loadStage(this.stage + 1);
    this.running = true;
    this._ensureLoop();
  }

  stop() {
    this.running = false;
    this._loopAlive = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _ensureLoop() {
    this._last = performance.now();
    if (this._loopAlive) return;
    this._loopAlive = true;
    const loop = (t) => {
      if (!this._loopAlive) {
        this._raf = 0;
        return;
      }
      const dt = Math.min(0.033, (t - this._last) / 1000);
      this._last = t;
      try {
        if (this.running) this.update(dt);
        this.draw();
      } catch (err) {
        console.error("Game loop error:", err);
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  loadStage(stage) {
    this.stage = stage;
    this.level = generateLevel(stage);
    this.shots = SHOTS_PER_STAGE;
    this.kills = 0;
    this.balls = [];
    this.pendingToFire = 0;
    this.fireCooldown = 0;
    this._stageClearing = false;
    this.fx = [];
    this.ballCountAtStageStart = this.ballCount;
    this._layoutBoard();
    if (this.level.isBoss) this.hooks.onBoss?.(this.stage, this.level.boss);
    this.hooks.onStage?.(this.stage, this.level);
  }

  /** Called after clear — meta growth (C) */
  applyClearGrowth(isBoss) {
    const gain = isBoss ? 2 : 1;
    this.ballCount = Math.min(MAX_BALL_COUNT, this.ballCount + gain);
    return gain;
  }

  resetBallCountForRetry() {
    this.ballCount = this.ballCountAtStageStart;
  }

  _layoutBoard() {
    const availW = W - BOARD_PAD * 2;
    const availH = H - HUD_H - FOOT_H;
    this.cellSize = Math.floor(Math.min(availW / COLS, availH / ROWS));
    this.board.w = this.cellSize * COLS;
    this.board.h = this.cellSize * ROWS;
    this.board.x = Math.floor((W - this.board.w) / 2);
    this.board.y = HUD_H + Math.floor((availH - this.board.h) / 2);
    const hero = this._heroLayout();
    this.cannon.x = hero.pivot.x;
    this.cannon.y = hero.pivot.y;
  }

  /** Body / arm / muzzle layout using mockup calibration. */
  _heroLayout(aimAngle = this.aimAngle) {
    const bodyImg = this.sprites.heroBody || this.sprites.cannon;
    const armImg = this.sprites.heroArm || this.sprites.cannon;
    const bodyW = bodyImg.width * HERO_CAL.bodyScale;
    const bodyH = bodyImg.height * HERO_CAL.bodyScale;
    const bodyX = (W - bodyW) / 2;
    const bodyY = H - bodyH - HERO_CAL.bottomPad;
    const pivot = {
      x: bodyX + bodyW * HERO_CAL.shoulderX,
      y: bodyY + bodyH * HERO_CAL.shoulderY,
    };
    const armW = armImg.width * HERO_CAL.armScale;
    const armH = armImg.height * HERO_CAL.armScale;
    // Guide / shot follow aim; arm art keeps calibration offset
    const angle = aimAngle;
    const armAngle = aimAngle + (HERO_CAL.angleOffsetDeg * Math.PI) / 180;
    const muzzle = {
      x: pivot.x + Math.cos(angle) * HERO_CAL.muzzleLen,
      y: pivot.y + Math.sin(angle) * HERO_CAL.muzzleLen,
    };
    return {
      bodyImg,
      armImg,
      bodyX,
      bodyY,
      bodyW,
      bodyH,
      pivot,
      armW,
      armH,
      angle,
      armAngle,
      muzzle,
    };
  }

  _clampAim(ang) {
    if (ang > 0) ang = ang > Math.PI / 2 ? AIM_MIN : AIM_MAX;
    return Math.max(AIM_MIN, Math.min(AIM_MAX, ang));
  }

  _bindInput() {
    const toLocal = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * W;
      const y = ((e.clientY - rect.top) / rect.height) * H;
      return { x, y };
    };

    const aimFrom = (p) => {
      const { pivot } = this._heroLayout();
      this.aimAngle = this._clampAim(Math.atan2(p.y - pivot.y, p.x - pivot.x));
    };

    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.running) return;
      const p = toLocal(e);
      const slot = this._hitLoadoutSlot(p);
      if (slot != null) {
        this._tapLoadout = true;
        this._trySelectAmmo(slot);
        return;
      }
      this._tapLoadout = false;
      this.pointerDown = true;
      this.canvas.setPointerCapture(e.pointerId);
      aimFrom(p);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.running || this._tapLoadout) return;
      aimFrom(toLocal(e));
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (!this.running) return;
      if (this._tapLoadout) {
        this._tapLoadout = false;
        return;
      }
      aimFrom(toLocal(e));
      if (this.pointerDown) this.tryShoot();
      this.pointerDown = false;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.pointerDown = false;
      this._tapLoadout = false;
    });
  }

  _hitLoadoutSlot(p) {
    const y = H - 52;
    if (Math.abs(p.y - y) > 36) return null;
    const slots = AMMO_TYPES.length;
    const startX = W / 2 - ((slots - 1) * 58) / 2;
    for (let i = 0; i < slots; i++) {
      const x = startX + i * 58;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= 28 * 28) return i;
    }
    return null;
  }

  _trySelectAmmo(index) {
    const def = AMMO_TYPES[index];
    if (!def) return;
    const unlocked = unlockedAmmoIds(this.bestStageCleared);
    if (!unlocked.includes(def.id)) {
      audio.ui();
      this.hooks.onAmmoLocked?.(def);
      return;
    }
    if (this._isVolleyActive()) return;
    this.selectedAmmo = def.id;
    audio.ui();
    this.hooks.onAmmoSelect?.(def);
  }

  _ammo() {
    return ammoById(this.selectedAmmo);
  }

  _isVolleyActive() {
    return this.balls.length > 0 || this.pendingToFire > 0;
  }

  tryShoot() {
    if (this._isVolleyActive() || this.shots <= 0) return;
    const ammo = this._ammo();
    this.shots -= 1;
    this.volleyAngle = this.aimAngle;
    const count = Math.max(1, Math.round(this.ballCount * ammo.volleyScale));
    this.pendingToFire = count;
    this.fireCooldown = 0;
    audio.shoot(ammo.id);
    const { muzzle } = this._heroLayout(this.volleyAngle);
    this._spawnFx(muzzle.x, muzzle.y, ammo.color, "muzzle", 10);
  }

  _spawnBall(overrides = {}) {
    if (this.balls.length >= MAX_ACTIVE_BALLS) return false;
    const ammo = this._ammo();
    const { muzzle, angle } = this._heroLayout(this.volleyAngle);
    const speed = ammo.speed;
    this.balls.push({
      x: muzzle.x,
      y: muzzle.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: Math.max(8, this.cellSize * 0.26 * ammo.radiusScale),
      hitCooldown: 0,
      life: BALL_LIFE,
      bounces: 0,
      ammoId: ammo.id,
      damage: ammo.damage,
      canSplit: ammo.id === "split",
      splitDone: false,
      pierce: ammo.id === "drill",
      spin: 0,
      ...overrides,
    });
    if (this.balls.length > 1 && this.balls.length % 4 === 0) {
      audio.shoot(ammo.id);
    }
    return true;
  }

  _growBalls(amount) {
    const before = this.ballCount;
    this.ballCount = Math.min(MAX_BALL_COUNT, this.ballCount + amount);
    const gained = this.ballCount - before;
    if (gained > 0 && this._isVolleyActive()) {
      this.pendingToFire += gained;
    }
    if (gained > 0) {
      this.score += gained * 5;
      audio.pickup();
    }
    return gained;
  }

  update(dt) {
    if (!this.running || !this.level) return;
    this._updateFx(dt);

    // A: staggered multi-ball fire
    if (this.pendingToFire > 0) {
      this.fireCooldown -= dt;
      while (this.pendingToFire > 0 && this.fireCooldown <= 0 && this.balls.length < MAX_ACTIVE_BALLS) {
        this._spawnBall();
        this.pendingToFire -= 1;
        this.fireCooldown += FIRE_GAP;
      }
      if (this.balls.length >= MAX_ACTIVE_BALLS) {
        this.fireCooldown = Math.max(this.fireCooldown, FIRE_GAP);
      }
    }

    if (!this._isVolleyActive()) {
      if (this.shots <= 0 && countTargets(this.level.grid) > 0) {
        this.running = false;
        this.hooks.onFail?.(this.stage, this.score, this.ballCount);
      }
      return;
    }

    const steps = 3;
    const sdt = dt / steps;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      if (this._stageClearing || !this.running) break;
      const b = this.balls[i];
      if (!b) continue;
      b.hitCooldown = Math.max(0, b.hitCooldown - dt);
      b.life -= dt;
      b.spin = (b.spin || 0) + dt * (b.ammoId === "drill" ? 14 : 4);
      let dead = b.life <= 0 || b.bounces > MAX_BOUNCES;

      for (let s = 0; s < steps && !dead; s++) {
        b.x += b.vx * sdt;
        b.y += b.vy * sdt;
        this._collideBounds(b);
        this._collideCells(b);
        if (this._stageClearing || !this.running) {
          dead = true;
          break;
        }
        if (b.y - b.r > H - 40) dead = true;
      }

      // trail fx
      if (!dead && Math.random() < (b.ammoId === "heavy" ? 0.35 : 0.2)) {
        this._spawnFx(b.x, b.y, ammoById(b.ammoId).color, "trail", 1);
      }

      if (dead && this.balls[i] === b) this.balls.splice(i, 1);
    }

    if (this._stageClearing) return;
    if (!this._isVolleyActive()) this._afterVolleyDone();
  }

  _afterVolleyDone() {
    if (this._stageClearing) return;
    if (countTargets(this.level.grid) <= 0) {
      this._finishClear();
      return;
    }
    if (this.shots <= 0) {
      this.running = false;
      this.hooks.onFail?.(this.stage, this.score, this.ballCount);
    }
  }

  _finishClear() {
    if (this._stageClearing) return;
    this._stageClearing = true;
    this.running = false;
    this.balls = [];
    this.pendingToFire = 0;
    const bonus = this.shots * 25 + this.ballCount * 2;
    this.score += 100 + bonus + (this.level.isBoss ? 250 : 0);
    const growth = this.applyClearGrowth(this.level.isBoss);
    this.hooks.onClear?.(this.stage, {
      kills: this.kills,
      shots: this.shots,
      ballCount: this.ballCount,
      growth,
      score: this.score,
      isBoss: this.level.isBoss,
      boss: this.level.boss,
    });
  }

  _collideBounds(b) {
    const left = this.board.x;
    const right = this.board.x + this.board.w;
    const top = this.board.y;
    let bounced = false;
    if (b.x - b.r < left) {
      b.x = left + b.r;
      b.vx = Math.abs(b.vx);
      b.bounces += 1;
      bounced = true;
    } else if (b.x + b.r > right) {
      b.x = right - b.r;
      b.vx = -Math.abs(b.vx);
      b.bounces += 1;
      bounced = true;
    }
    if (b.y - b.r < top) {
      b.y = top + b.r;
      b.vy = Math.abs(b.vy);
      b.bounces += 1;
      bounced = true;
    }
    if (bounced) this._throttledBounce();
  }

  _collideCells(b) {
    const { grid } = this.level;
    const cs = this.cellSize;
    const c0 = Math.floor((b.x - this.board.x - b.r) / cs);
    const c1 = Math.floor((b.x - this.board.x + b.r) / cs);
    const r0 = Math.floor((b.y - this.board.y - b.r) / cs);
    const r1 = Math.floor((b.y - this.board.y + b.r) / cs);
    const dmg = b.damage || 1;

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
        const v = grid[r][c];
        if (v === 0) continue;

        const cx = this.board.x + c * cs + cs / 2;
        const cy = this.board.y + r * cs + cs / 2;
        const half = cs * 0.42;
        const nearestX = Math.max(cx - half, Math.min(b.x, cx + half));
        const nearestY = Math.max(cy - half, Math.min(b.y, cy + half));
        const dx = b.x - nearestX;
        const dy = b.y - nearestY;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > b.r * b.r) continue;

        if (isPickup(v)) {
          grid[r][c] = 0;
          this._growBalls(pickupAmount(v));
          continue;
        }

        const dist = Math.sqrt(dist2) || 0.001;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = b.r - dist;

        const target = isTarget(v);
        const hpBefore = target ? cellHp(v) : 0;
        const pierceHit = target && b.pierce && hpBefore > 0 && hpBefore <= dmg;

        if (pierceHit) {
          // drill: punch through soft targets without reversing
          b.x -= nx * Math.min(overlap + 2, cs * 0.35);
          b.y -= ny * Math.min(overlap + 2, cs * 0.35);
        } else {
          b.x += nx * overlap;
          b.y += ny * overlap;
          const dot = b.vx * nx + b.vy * ny;
          if (dot < 0) {
            b.vx -= 2 * dot * nx;
            b.vy -= 2 * dot * ny;
            b.bounces += 1;
            this._throttledBounce();
          }
        }

        if (target && b.hitCooldown <= 0) {
          this._damageCell(r, c, b);
          b.hitCooldown = pierceHit ? 0.02 : 0.045;
          if (b.canSplit && !b.splitDone) this._doSplit(b);
        }
      }
    }
  }

  _doSplit(b) {
    b.splitDone = true;
    b.canSplit = false;
    const speed = Math.hypot(b.vx, b.vy) || ammoById("split").speed;
    const base = Math.atan2(b.vy, b.vx);
    const spread = 0.48;
    for (const sign of [-1, 1]) {
      const ang = base + sign * spread;
      this._spawnBall({
        x: b.x + Math.cos(ang) * 6,
        y: b.y + Math.sin(ang) * 6,
        ang,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        canSplit: false,
        splitDone: true,
        pierce: false,
        hitCooldown: 0.08,
        life: Math.max(2.5, (b.life || BALL_LIFE) * 0.85),
      });
    }
    this._spawnFx(b.x, b.y, ammoById("split").color, "burst", 14);
    audio.shoot("split");
  }

  _throttledBounce() {
    const now = performance.now();
    if (now - (this._lastBounceSfx || 0) < 45) return;
    this._lastBounceSfx = now;
    audio.bounce();
  }

  _damageCell(r, c, b) {
    const grid = this.level.grid;
    const v = grid[r][c];
    if (!isTarget(v)) return;
    const typeId = b?.ammoId || this.selectedAmmo;
    const def = ammoById(typeId);
    const dmg = Math.max(1, b?.damage || def.damage || 1);
    const cx = this.board.x + c * this.cellSize + this.cellSize / 2;
    const cy = this.board.y + r * this.cellSize + this.cellSize / 2;

    if (isBossCell(v)) {
      const type = bossType(v);
      const hp = cellHp(v) - dmg;
      this.score += 12 * dmg;
      if (hp <= 0) {
        grid[r][c] = 0;
        this.kills += 1;
        this.score += 200;
        audio.destroy(typeId);
        this._spawnFx(cx, cy, def.color, "burst", typeId === "heavy" ? 22 : 16);
      } else {
        grid[r][c] = encodeBoss(type, hp);
        audio.hit(typeId);
        this._spawnFx(cx, cy, def.color, "hit", typeId === "heavy" ? 12 : 8);
      }
    } else {
      const hp = v - dmg;
      this.score += 10 * Math.min(v, dmg) * (typeId === "heavy" ? 1.2 : 1);
      if (hp <= 0) {
        grid[r][c] = 0;
        this.kills += 1;
        audio.destroy(typeId);
        this._spawnFx(cx, cy, def.color, "burst", typeId === "heavy" ? 18 : 12);
      } else {
        grid[r][c] = hp;
        audio.hit(typeId);
        this._spawnFx(cx, cy, def.color, "hit", 7);
      }
    }

    if (countTargets(grid) <= 0) {
      this._finishClear();
    }
  }

  _spawnFx(x, y, color, kind, count = 8) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd =
        kind === "trail"
          ? 30 + Math.random() * 50
          : kind === "muzzle"
            ? 90 + Math.random() * 140
            : 100 + Math.random() * 200;
      const maxLife =
        kind === "trail" ? 0.22 + Math.random() * 0.12 : kind === "muzzle" ? 0.32 : 0.4 + Math.random() * 0.2;
      this.fx.push({
        x,
        y,
        vx: Math.cos(ang) * spd * (kind === "muzzle" ? 0.55 : 1),
        vy: Math.sin(ang) * spd * (kind === "muzzle" ? 0.55 : 1) - (kind === "muzzle" ? 60 : 0),
        life: maxLife,
        maxLife,
        r: kind === "burst" ? 3.5 + Math.random() * 3 : 2 + Math.random() * 2.5,
        color,
        kind,
      });
    }
    if (this.fx.length > 260) this.fx.splice(0, this.fx.length - 260);
  }

  _updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const p = this.fx[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "trail") {
        p.vx *= 0.9;
        p.vy *= 0.9;
      } else {
        p.vy += 140 * dt;
        p.vx *= 0.98;
      }
      if (p.life <= 0) this.fx.splice(i, 1);
    }
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    this._drawBg(ctx);

    if (this.level) {
      this._drawBoard(ctx);
      this._drawCells(ctx);
    }

    this._drawCannon(ctx);
    if (!this._isVolleyActive()) this._drawAim(ctx);
    this._drawFx(ctx);
    this._drawBalls(ctx);
    this._drawHud(ctx);
    this._drawLoadout(ctx);
  }

  _drawBg(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#1a1630");
    g.addColorStop(1, "#12101c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 40; i++) {
      const x = (i * 97 + this.stage * 13) % W;
      const y = (i * 53 + 40) % (H * 0.7);
      ctx.beginPath();
      ctx.arc(x, y, i % 5 === 0 ? 2 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawBoard(ctx) {
    const { x, y, w, h } = this.board;
    ctx.fillStyle = "rgba(26, 22, 48, 0.9)";
    roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(122, 240, 255, 0.22)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  _drawCells(ctx) {
    const cs = this.cellSize;
    const grid = this.level.grid;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        const x = this.board.x + c * cs;
        const y = this.board.y + r * cs;

        if (isPickup(v)) {
          this._drawPickup(ctx, x, y, cs, pickupAmount(v));
          continue;
        }

        const img = spriteForCell(this.sprites, v);
        const pad = isBossCell(v) ? 1 : 3;
        if (img) ctx.drawImage(img, x + pad, y + pad, cs - pad * 2, cs - pad * 2);
        if (isBossCell(v)) {
          ctx.fillStyle = "#fff";
          ctx.font = `900 ${Math.floor(cs * 0.28)}px Nunito, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(String(cellHp(v)), x + cs / 2, y + cs - 4);
        }
      }
    }
  }

  _drawPickup(ctx, x, y, cs, amount) {
    const cx = x + cs / 2;
    const cy = y + cs / 2;
    const rad = cs * 0.36;
    const g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, 2, cx, cy, rad);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#7af0ff");
    g.addColorStop(1, "#2bb3d0");
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.fillStyle = "#15485a";
    ctx.font = `900 ${Math.floor(cs * 0.32)}px Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`+${amount}`, cx, cy + 1);
  }

  _drawAim(ctx) {
    const ammo = this._ammo();
    const { muzzle, angle } = this._heroLayout(this.aimAngle);
    const len = 220;
    const x2 = muzzle.x + Math.cos(angle) * len;
    const y2 = muzzle.y + Math.sin(angle) * len;
    ctx.strokeStyle = ammo.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(muzzle.x, muzzle.y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.fillStyle = ammo.color;
    ctx.beginPath();
    ctx.arc(muzzle.x, muzzle.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawCannon(ctx) {
    const aim = this._isVolleyActive() ? this.volleyAngle : this.aimAngle;
    const {
      bodyImg,
      armImg,
      bodyX,
      bodyY,
      bodyW,
      bodyH,
      pivot,
      armW,
      armH,
      armAngle,
    } = this._heroLayout(aim);

    ctx.drawImage(bodyImg, bodyX, bodyY, bodyW, bodyH);

    ctx.save();
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(armAngle - (-Math.PI / 2));
    ctx.drawImage(armImg, -armW * HERO_CAL.armPivotX, -armH * HERO_CAL.armPivotY, armW, armH);
    ctx.restore();
  }

  _drawBalls(ctx) {
    for (const b of this.balls) {
      const def = ammoById(b.ammoId);
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.ammoId === "drill") ctx.rotate(b.spin || 0);
      ctx.shadowColor = def.color;
      ctx.shadowBlur = b.ammoId === "heavy" ? 20 : 14;

      if (b.ammoId === "heavy") {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff3d6";
        ctx.beginPath();
        ctx.arc(-b.r * 0.28, -b.r * 0.28, b.r * 0.38, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ff7a2e";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 1.15, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.ammoId === "split") {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(-b.r * 0.35, 0, b.r * 0.72, 0, Math.PI * 2);
        ctx.arc(b.r * 0.35, 0, b.r * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.ammoId === "drill") {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const rr = i % 2 === 0 ? b.r * 1.25 : b.r * 0.55;
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#eaffc8";
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 0.35, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const img = this.sprites.plasma;
        const s = b.r * 2.4;
        ctx.shadowBlur = 0;
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
      }
      ctx.restore();
    }
  }

  _drawFx(ctx) {
    for (const p of this.fx) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a * (p.kind === "trail" ? 0.55 : 0.9);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      const rr = p.r * (0.4 + a * 0.9);
      if (p.kind === "burst") {
        ctx.moveTo(p.x + rr, p.y);
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          ctx.lineTo(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr);
        }
        ctx.closePath();
      } else {
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawHud(ctx) {
    ctx.fillStyle = "rgba(18, 16, 28, 0.82)";
    ctx.fillRect(0, 0, W, HUD_H);

    ctx.fillStyle = "#cbb8e8";
    ctx.font = "800 20px Nunito, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(this.level?.name ?? `Sector ${this.stage}`, 28, 28);

    const ammo = this._ammo();
    ctx.fillStyle = ammo.color;
    ctx.font = "900 22px Nunito, sans-serif";
    ctx.fillText(`공 ${this.ballCount} · ${ammo.name}`, 28, 58);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd56a";
    ctx.font = "800 20px Nunito, sans-serif";
    ctx.fillText(`발사 ${this.shots}/${SHOTS_PER_STAGE}`, W - 28, 28);

    ctx.fillStyle = ammo.color;
    ctx.fillText(this._isVolleyActive() ? `비행 ${this.balls.length}` : "", W - 28, 58);

    const inCycle = ((this.stage - 1) % 5) + 1;
    const slots = 5;
    const barW = W - 80;
    const slotW = barW / slots;
    const y = 78;
    for (let i = 0; i < slots; i++) {
      const x = 40 + i * slotW + 4;
      const on = i < inCycle;
      const boss = i === slots - 1;
      ctx.fillStyle = boss ? (on ? "#ff6b8a" : "#3a3358") : on ? "#7af0ff" : "#3a3358";
      roundRect(ctx, x, y, slotW - 8, 8, 6);
      ctx.fill();
    }

    ctx.fillStyle = "#ffd56a";
    ctx.font = "800 20px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`SCORE ${this.score}`, W / 2, 34);
  }

  _drawLoadout(ctx) {
    const y = H - 52;
    const unlocked = unlockedAmmoIds(this.bestStageCleared);
    const slots = AMMO_TYPES.length;
    const startX = W / 2 - ((slots - 1) * 58) / 2;

    ctx.fillStyle = "rgba(18, 16, 28, 0.55)";
    roundRect(ctx, startX - 40, y - 36, (slots - 1) * 58 + 80, 72, 16);
    ctx.fill();

    for (let i = 0; i < slots; i++) {
      const def = AMMO_TYPES[i];
      const x = startX + i * 58;
      const open = unlocked.includes(def.id);
      const selected = open && this.selectedAmmo === def.id;

      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      ctx.fillStyle = open ? `${def.color}33` : "#2a2540";
      ctx.fill();
      ctx.lineWidth = selected ? 4 : 2;
      ctx.strokeStyle = selected ? def.color : open ? `${def.color}88` : "rgba(122,240,255,0.2)";
      ctx.stroke();

      if (open) {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        if (def.id === "split") {
          ctx.arc(x - 6, y, 7, 0, Math.PI * 2);
          ctx.arc(x + 6, y, 7, 0, Math.PI * 2);
          ctx.fill();
        } else if (def.id === "heavy") {
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.fill();
        } else if (def.id === "drill") {
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
            const rr = k % 2 === 0 ? 11 : 5;
            const px = x + Math.cos(a) * rr;
            const py = y + Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = "#8a7aaa";
        ctx.font = "700 14px Nunito, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🔒", x, y - 1);
        ctx.fillStyle = "#6a5f88";
        ctx.font = "800 10px Nunito, sans-serif";
        ctx.fillText(`S${def.unlockAt}`, x, y + 18);
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
