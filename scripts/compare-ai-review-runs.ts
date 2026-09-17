/**
 * Compare AI Review Board runs (v1 / v2 / optional v3).
 * Usage:
 *   npx tsx scripts/compare-ai-review-runs.ts [v2RunId] [v3RunId]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

async function load(runId: string) {
  const dir = path.join(process.cwd(), 'data', 'ai-review-board', runId);
  const independent = JSON.parse(
    await fs.readFile(path.join(dir, 'independent-analysis.json'), 'utf8'),
  ) as { memberId: string; originalOpinion: string; problems: string[]; judgmentBasis: string }[];
  const debate = JSON.parse(await fs.readFile(path.join(dir, 'debate.json'), 'utf8')) as {
    memberId: string;
    revisionStatus?: 'UNCHANGED' | 'PARTIAL' | 'FULL';
    revised: boolean;
    disagreement: string[];
    agreement: string[];
    weakEvidence?: string[];
    revisionReason?: string | null;
  }[];
  const final = JSON.parse(await fs.readFile(path.join(dir, 'final.json'), 'utf8')) as {
    statusSummary: string;
    overallTrendScore: number | null;
    confidence: number;
  };
  const evidence = JSON.parse(await fs.readFile(path.join(dir, 'evidence.json'), 'utf8')) as {
    aggregates: Record<string, unknown>;
    metricDefinitions?: Record<string, string>;
  };
  return { independent, debate, final, evidence };
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
  const hasStatus = run.debate.some((d) => typeof d.revisionStatus === 'string');
  return {
    label,
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
    disagreementItems: run.debate.reduce((n, d) => n + d.disagreement.length, 0),
    weakEvidenceItems: run.debate.reduce((n, d) => n + (d.weakEvidence?.length ?? 0), 0),
    revisionCount: run.debate.filter((d) =>
      d.revisionStatus === 'PARTIAL' || d.revisionStatus === 'FULL' || d.revised,
    ).length,
    partialRevisionCount: hasStatus
      ? run.debate.filter((d) => d.revisionStatus === 'PARTIAL').length
      : null,
    fullRevisionCount: hasStatus
      ? run.debate.filter((d) => d.revisionStatus === 'FULL').length
      : null,
    unchangedCount: hasStatus
      ? run.debate.filter((d) => d.revisionStatus === 'UNCHANGED').length
      : null,
    revisionStatuses: hasStatus
      ? Object.fromEntries(run.debate.map((d) => [d.memberId, d.revisionStatus]))
      : null,
    overallTrendScore: run.final.overallTrendScore,
    confidence: run.final.confidence,
    statusPreview: run.final.statusSummary.slice(0, 280),
  };
}

async function main() {
  const v1 = 'run-2026-09-17T07-53-24-323Z';
  const v2 = process.argv[2] || 'run-2026-09-17T09-27-13-078Z';
  const v3 = process.argv[3];

  const out: Record<string, unknown> = {
    v1: summarize(v1, await load(v1)),
    v2: summarize(v2, await load(v2)),
  };
  if (v3) {
    out.v3 = summarize(v3, await load(v3));
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
