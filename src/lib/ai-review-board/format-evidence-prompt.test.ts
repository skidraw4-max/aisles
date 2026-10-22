/**
 * Run: node --import tsx --test src/lib/ai-review-board/format-evidence-prompt.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildStubEvidencePack } from './evidence-pack';
import {
  formatEvidencePackForPrompt,
  metricDefinitionsForbidActiveUserMisread,
} from './format-evidence-prompt';
import { EVIDENCE_METRIC_DEFINITIONS, EVIDENCE_METRIC_PROMPT_GUARD } from './types';

describe('metricDefinitions forbid active-user misread', () => {
  it('documents newUsers vs activeUsers vs views clearly', () => {
    assert.equal(metricDefinitionsForbidActiveUserMisread(), true);
    assert.match(EVIDENCE_METRIC_DEFINITIONS.newUsersLast7d, /NOT active/i);
    assert.match(EVIDENCE_METRIC_DEFINITIONS.activeUsersLast7d, /Post|Comment|활동/);
    assert.match(EVIDENCE_METRIC_DEFINITIONS.viewsLast7d, /PostViewDaily/);
    assert.match(EVIDENCE_METRIC_DEFINITIONS.usersLast7d, /DEPRECATED/i);
  });
});

describe('formatEvidencePackForPrompt', () => {
  it('puts metric guard and definitions before aggregate numbers', () => {
    const pack = buildStubEvidencePack({
      aggregates: {
        newUsersLast7d: 0,
        usersLast7d: 0,
        activeUsersLast7d: null,
        viewsLast7d: null,
      },
    });
    const text = formatEvidencePackForPrompt(pack);
    const guardIdx = text.indexOf(EVIDENCE_METRIC_PROMPT_GUARD.slice(0, 40));
    const defsIdx = text.indexOf('metricDefinitions');
    const jsonIdx = text.indexOf('EvidencePack JSON');
    assert.ok(guardIdx >= 0);
    assert.ok(defsIdx > guardIdx);
    assert.ok(jsonIdx > defsIdx);
    assert.match(text, /NEVER call this "active users"/i);
  });

  it('allows stub nulls; definitions no longer force always-null', () => {
    const pack = buildStubEvidencePack();
    assert.equal(pack.aggregates.activeUsersLast7d, null);
    assert.equal(pack.aggregates.viewsLast7d, null);
    assert.doesNotMatch(EVIDENCE_METRIC_DEFINITIONS.activeUsersLast7d, /반드시 null/);
  });
});
