/**
 * Compare AI Review Board runs (v1 / v2 / v3 / optional v4).
 * Usage:
 *   npx tsx scripts/compare-ai-review-runs.ts [v2] [v3] [v4]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

async function load(runId: string) {
  const dir = path.join(process.cwd(), 'data', 'ai-review-board', runId);
  const independent = JSON.parse(
    await fs.readFile(path.join(dir, 'independent-analysis.json'), 'utf8'),
  ) as { memberId: string; originalOpinion: string; problems: string[]; judgmentBasis: string; confidence: number }[];
  const debate = JSON.parse(await fs.readFile(path.join(dir, 'debate.json'), 'utf8')) as {
    memberId: string;
    revisionStatus?: string;
    revised?: boolean;
    disagreement: string[];
    agreement: string[];
    weakEvidence?: string[];
    needsVerification?: string[];
    confidence?: number;
  }[];
  let revisions: {
    memberId: string;
    revisionStatus: string;
    revised: boolean;
    retainReason: string | null;
    revisionReason: string | null;
    changedClaims: string[];
    confidenceBefore: number;
    confidenceAfter: number;
    confidenceChangeReason: string;
    finalOpinion: string;
    originalOpinion: string;
  }[] | null = null;
  try {
    revisions = JSON.parse(await fs.readFile(path.join(dir, 'revisions.json'), 'utf8'));
  } catch {
    revisions = null;
  }
  const critic = JSON.parse(await fs.readFile(path.join(dir, 'critic.json'), 'utf8')) as {
    herdingDetected?: boolean;
    herding?: { ok: boolean; flags: string[] };
    overclaiming?: { ok: boolean; flags: string[] };
    fabrication?: { ok: boolean; flags: string[] };
  };
  const final = JSON.parse(await fs.readFile(path.join(dir, 'final.json'), 'utf8')) as {
    statusSummary: string;
    overallTrendScore: number | null;
    confidence: number;
  };
  const evidence = JSON.parse(await fs.readFile(path.join(dir, 'evidence.json'), 'utf8')) as {
    aggregates: Record<string, unknown>;
    metricDefinitions?: Record<string, string>;
  };
  const runMeta = JSON.parse(await fs.readFile(path.join(dir, 'run.json'), 'utf8')) as {
    budget?: { usedCalls?: number };
  };
  return { independent, debate, revisions, critic, final, evidence, runMeta };
}

function countActiveMisread(texts: string[]): number {
  const re =
    /active users?|활성\s*사용자|DAU|WAU|zero active|활성\s*유저|usersLast7d:\s*0[^\n]{0,80}(active|engagement crisis|활성)/gi;
  return texts.reduce((n, t) => n + ((t.match(re) || []).length > 0 ? 1 : 0), 0);
}

function countSignupAware(texts: string[]): number {
  const re = /newUsersLast7d|신규\s*가입|new signup|signups?/gi;
  return texts.reduce((n, t) => n + ((t.match(re) || []).length > 0 ? 1 : 0), 0);
}

function summarize(label: string, run: Awaited<ReturnType<typeof load>>) {
  const texts = [
    ...run.independent.map((i) => `${i.originalOpinion}\n${i.problems.join('\n')}\n${i.judgmentBasis}`),
    run.final.statusSummary,
  ];
  const revs = run.revisions;
  const hasRevFile = Array.isArray(revs) && revs.length > 0;
  const debateHasStatus = run.debate.some((d) => typeof d.revisionStatus === 'string');

  const revisionCount = hasRevFile
    ? revs!.filter((r) => r.revised || r.revisionStatus === 'PARTIAL' || r.revisionStatus === 'FULL')
        .length
    : run.debate.filter((d) => d.revised || d.revisionStatus === 'PARTIAL' || d.revisionStatus === 'FULL')
        .length;

  return {
    label,
    usedCalls: run.runMeta.budget?.usedCalls ?? null,
    aggregates: {
      usersLast7d: run.evidence.aggregates.usersLast7d,
      newUsersLast7d: run.evidence.aggregates.newUsersLast7d,
      activeUsersLast7d: run.evidence.aggregates.activeUsersLast7d,
      viewsLast7d: run.evidence.aggregates.viewsLast7d,
      commentsLast7d: run.evidence.aggregates.commentsLast7d,
      postsLast7d: run.evidence.aggregates.postsLast7d,
    },
    hasMetricDefinitions: Boolean(run.evidence.metricDefinitions?.newUsersLast7d),
    membersWithActiveMisreadSignal: countActiveMisread(texts),
    membersWithSignupAwareSignal: countSignupAware(texts),
    agreementItems: run.debate.reduce((n, d) => n + d.agreement.length, 0),
    disagreementItems: run.debate.reduce((n, d) => n + d.disagreement.length, 0),
    weakEvidenceItems: run.debate.reduce((n, d) => n + (d.weakEvidence?.length ?? 0), 0),
    needsVerificationItems: run.debate.reduce((n, d) => n + (d.needsVerification?.length ?? 0), 0),
    revisionCount,
    partialRevisionCount: hasRevFile
      ? revs!.filter((r) => r.revisionStatus === 'PARTIAL').length
      : debateHasStatus
        ? run.debate.filter((d) => d.revisionStatus === 'PARTIAL').length
        : null,
    fullRevisionCount: hasRevFile
      ? revs!.filter((r) => r.revisionStatus === 'FULL').length
      : debateHasStatus
        ? run.debate.filter((d) => d.revisionStatus === 'FULL').length
        : null,
    unchangedCount: hasRevFile
      ? revs!.filter((r) => r.revisionStatus === 'UNCHANGED').length
      : debateHasStatus
        ? run.debate.filter((d) => d.revisionStatus === 'UNCHANGED').length
        : null,
    revisionStatuses: hasRevFile
      ? Object.fromEntries(revs!.map((r) => [r.memberId, r.revisionStatus]))
      : debateHasStatus
        ? Object.fromEntries(run.debate.map((d) => [d.memberId, d.revisionStatus]))
        : null,
    confidence: hasRevFile
      ? {
          before: revs!.map((r) => ({ [r.memberId]: r.confidenceBefore })),
          after: revs!.map((r) => ({ [r.memberId]: r.confidenceAfter })),
          deltas: revs!.map((r) => ({
            [r.memberId]: Number((r.confidenceAfter - r.confidenceBefore).toFixed(3)),
          })),
        }
      : null,
    criticFlags: {
      herdingDetected: run.critic.herdingDetected ?? null,
      herding: run.critic.herding ?? null,
      overclaiming: run.critic.overclaiming ?? null,
      fabrication: run.critic.fabrication ?? null,
    },
    overallTrendScore: run.final.overallTrendScore,
    finalConfidence: run.final.confidence,
    statusPreview: run.final.statusSummary.slice(0, 280),
  };
}

async function main() {
  const v1 = 'run-2026-09-17T07-53-24-323Z';
  const v2 = process.argv[2] || 'run-2026-09-17T09-27-13-078Z';
  const v3 = process.argv[3] || 'run-2026-09-17T10-09-59-178Z';
  const v4 = process.argv[4];

  const out: Record<string, unknown> = {
    v1: summarize(v1, await load(v1)),
    v2: summarize(v2, await load(v2)),
    v3: summarize(v3, await load(v3)),
  };
  if (v4) {
    out.v4 = summarize(v4, await load(v4));
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
