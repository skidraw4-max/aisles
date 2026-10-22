/**
 * RM-05 (I-006, I-007, D-11): UI controls must match what the server implements.
 * - every <WriteControl> targets planJuryCommand, which returns NOT_IMPLEMENTED for writes -> must be disabled ('준비 중')
 * - re-review chains run on the mock review-board LLM -> buttons say (Mock)
 * - the gate login link must stay on the Jury host (juryHref)
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { planJuryCommand } from './access';
import type { JuryActor } from './access';

const root = path.resolve(process.cwd(), 'src/app/(jury)/jury');
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') ? [full] : [];
  });
}
const sources = tsxFiles(root).map((file) => ({ file, text: readFileSync(file, 'utf8') }));

test('write actions are still NOT_IMPLEMENTED on the server', () => {
  const actor: JuryActor = { ok: true, userId: 'u', tenantId: 't', role: 'OWNER', membershipId: 'm' };
  for (const action of ['improvement.write', 'agent.execute', 'settings.write'] as const) {
    const out = planJuryCommand({ actor, action, resourceTenantId: 't' });
    assert.equal(out.ok ? 'OK' : out.reason, 'NOT_IMPLEMENTED', action);
  }
});

test('every WriteControl usage is rendered disabled with a hint', () => {
  let uses = 0;
  for (const { file, text } of sources) {
    for (const chunk of text.split('<WriteControl ').slice(1)) {
      const usage = chunk.slice(0, chunk.indexOf('\n'));
      uses += 1;
      assert.match(usage, /disabledHint=/, `${path.basename(file)}: ${usage.slice(0, 80)}`);
    }
  }
  assert.ok(uses >= 3);
  const ui = readFileSync(path.join(root, 'ui.tsx'), 'utf8');
  assert.ok(ui.includes('(준비 중)'));
  assert.ok(ui.includes('disabled aria-disabled="true"'));
});

test('mock re-review buttons are labeled Mock', () => {
  for (const { file, text } of sources) {
    assert.equal(/>재심사 실행<\/button>/.test(text), false, path.basename(file));
  }
  const store = readFileSync(path.resolve(process.cwd(), 'src/lib/jury-product/change-gate-rereview-store.ts'), 'utf8');
  assert.ok(store.includes('createMockReviewBoardLlm'), 'labels assume the mock default core; update them if this changes');
});

test('login link stays on the Jury host', () => {
  for (const { file, text } of sources) {
    assert.equal(text.includes('href="/login"'), false, path.basename(file));
  }
});
