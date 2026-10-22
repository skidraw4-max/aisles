#!/usr/bin/env node
// RM-00 test baseline gate.
// Runs the full node:test suite and fails ONLY on failures that are not in
// test/baseline/known-failures.json. See docs/jury-test-baseline.md.
// Usage: node scripts/test-baseline.mjs [--write-observed <path>]
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "mobile", "dist", "coverage"]);
const TEST_RE = /\.test\.(ts|tsx|cjs|mjs)$/;

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = path.join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) collect(p, out);
    else if (TEST_RE.test(entry)) out.push(path.relative(root, p));
  }
  return out;
}

const files = collect(root, []).sort();
const known = JSON.parse(readFileSync(path.join(root, "test/baseline/known-failures.json"), "utf8"));
const key = (f) => `${f.file} :: ${f.name}`;
const knownKeys = new Set(known.failures.map(key));

const res = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-reporter=./test/baseline/failure-reporter.mjs", ...files],
  { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);

const events = res.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
// Leaf tests only (suites aggregate children); file-level load failures have suite=false.
const leaves = events.filter((e) => !e.suite);
const fails = leaves.filter((e) => e.status === "fail").map((e) => ({
  ...e,
  file: e.file ? path.relative(root, e.file) : null,
  // file-level load failures are named by absolute path; normalise for CI portability
  name: path.isAbsolute(e.name) ? path.relative(root, e.name) : e.name,
}));
const passes = leaves.filter((e) => e.status === "pass").length;

const newFails = fails.filter((f) => !knownKeys.has(key(f)));
const observed = new Set(fails.map(key));
const fixed = known.failures.filter((f) => !observed.has(key(f)));

const wi = process.argv.indexOf("--write-observed");
if (wi > -1) writeFileSync(process.argv[wi + 1], JSON.stringify(fails, null, 2));

console.log(`[test-baseline] files=${files.length} tests=${passes + fails.length} pass=${passes} fail=${fails.length} known=${known.failures.length}`);
if (fixed.length) {
  console.log(`[test-baseline] ${fixed.length} known failure(s) now pass (remove from known-failures.json):`);
  for (const f of fixed) console.log(`  FIXED  ${key(f)}`);
}
if (newFails.length) {
  console.error(`[test-baseline] FAIL: ${newFails.length} failure(s) outside the known list (regressions):`);
  for (const f of newFails) console.error(`  NEW    ${key(f)}\n         ${f.error ?? ""}`);
  process.exit(1);
}
if (passes === 0) { console.error("[test-baseline] FAIL: no tests ran"); process.exit(1); }
console.log("[test-baseline] OK: no failures outside the known list");
