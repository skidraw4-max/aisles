/**
 * 'use client' 컴포넌트가 Prisma·서버 전용 모듈을 import 하지 않는지 검사.
 * CI·로컬 빌드 전에 실행 (package.json check:client-boundary).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const FORBIDDEN_PATTERNS = [
  { re: /import\s+(?!type\s)[^;]*from\s+['"]@\/lib\/prisma['"]/, label: '@/lib/prisma' },
  { re: /import\s+(?!type\s)[^;]*from\s+['"]@prisma\/client['"]/, label: '@prisma/client' },
  { re: /import\s+(?!type\s)[^;]*from\s+['"]@\/lib\/ugc-hub\.server['"]/, label: '@/lib/ugc-hub.server' },
  { re: /import\s+(?!type\s)[^;]*from\s+['"][^'"]+\.server['"]/, label: '*.server module' },
  { re: /require\s*\(\s*['"]@\/lib\/prisma['"]\s*\)/, label: 'require(@/lib/prisma)' },
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(full, out);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function isClientFile(content) {
  const head = content.slice(0, 800);
  return /^\s*['"]use client['"]\s*;?/m.test(head);
}

const files = walk(SRC);
const violations = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (!isClientFile(content)) continue;
  const rel = path.relative(ROOT, file);
  for (const { re, label } of FORBIDDEN_PATTERNS) {
    if (re.test(content)) {
      violations.push({ file: rel, label });
    }
  }
}

if (violations.length > 0) {
  console.error('[check:client-boundary] Forbidden imports in client components:\n');
  for (const v of violations) {
    console.error(`  ${v.file} → ${v.label}`);
  }
  process.exit(1);
}

console.log(`[check:client-boundary] OK (${files.length} files scanned)`);
