import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/(jury)/jury/jury.module.css"), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  assert.ok(m, `token --${name} must be defined`);
  return m[1];
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test("I-082 dark token text/accent pairs meet WCAG AA (4.5:1)", () => {
  const surfaces = ["jury-bg", "jury-surface-1", "jury-surface-2", "jury-surface-3"];
  const fgs = ["jury-text", "jury-text-muted", "jury-text-subtle", "jury-accent", "jury-warn"];
  for (const s of surfaces) {
    for (const f of fgs) {
      const r = contrast(token(f), token(s));
      assert.ok(r >= 4.5, `${f} on ${s} = ${r.toFixed(2)}`);
    }
  }
  assert.ok(contrast(token("jury-bg"), token("jury-accent")) >= 4.5, "dark text on accent");
});

test("I-082 surface levels are ordered dark to light", () => {
  const order = ["jury-bg", "jury-surface-1", "jury-surface-2", "jury-surface-3"].map((t) => luminance(token(t)));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
});

// accent fills (mint/accent, luminance < 0.7) are intentional primary buttons; near-white surfaces are not.
test("I-082 no white or light backgrounds remain in jury.module.css", () => {
  const offenders: string[] = [];
  css.split("\n").forEach((line, i) => {
    if (!/^\s*background(-color)?\s*:/.test(line)) return;
    for (const hex of line.match(/#[0-9a-fA-F]{6}\b|#[fF]{3}\b/g) ?? []) {
      const full = hex.length === 4 ? "#ffffff" : hex;
      if (luminance(full) > 0.7) offenders.push(`${i + 1}: ${line.trim()}`);
    }
    if (/var\(--jury-white\b/.test(line)) offenders.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, []);
});
