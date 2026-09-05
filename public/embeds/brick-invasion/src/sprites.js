import { bossType, isBossCell } from "./bosses.js";

const PATHS = {
  cannon: "./design/sprites/cannon-hero.png",
  heroBody: "./design/sprites/hero-body.png",
  heroArm: "./design/sprites/hero-arm-gun.png",
  plasma: "./design/sprites/plasma-ball.svg",
  swarm1: "./design/sprites/swarm-1.svg",
  swarm2: "./design/sprites/swarm-2.svg",
  swarm3: "./design/sprites/swarm-3.svg",
  wall: "./design/sprites/wall.svg",
  boss0: "./design/sprites/boss-0.svg",
  boss1: "./design/sprites/boss-1.svg",
  boss2: "./design/sprites/boss-2.svg",
  boss3: "./design/sprites/boss-3.svg",
  boss4: "./design/sprites/boss-4.svg",
  hive: "./design/sprites/boss-0.svg",
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadSprites() {
  const entries = await Promise.all(
    Object.entries(PATHS).map(async ([key, src]) => [key, await loadImage(src)])
  );
  return Object.fromEntries(entries);
}

export function spriteForCell(sprites, value) {
  if (value === -1) return sprites.wall;
  if (isBossCell(value)) {
    const t = bossType(value);
    return sprites[`boss${t}`] || sprites.boss0;
  }
  if (value === 1) return sprites.swarm1;
  if (value === 2) return sprites.swarm2;
  if (value === 3) return sprites.swarm3;
  return null;
}
