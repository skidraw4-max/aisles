/**
 * Compare v1 vs v2 runs for EvidencePack metric misread signals (read-only).
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
    revised: boolean;
    disagreement: string[];
    agreement: string[];
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

async function main() {
  const v1 = 'run-2026-09-17T07-53-24-323Z';
  const v2 = process.argv[2] || 'run-2026-09-17T09-27-13-078Z';
  const a = await load(v1);
  const b = await load(v2);

  const summarize = (label: string, run: Awaited<ReturnType<typeof load>>) => {
    const texts = [
      ...run.independent.map((i) => `${i.originalOpinion}\n${i.problems.join('\n')}\n${i.judgmentBasis}`),
      run.final.statusSummary,
    ];
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
      revisionCount: run.debate.filter((d) => d.revised).length,
      disagreementItems: run.debate.reduce((n, d) => n + d.disagreement.length, 0),
      overallTrendScore: run.final.overallTrendScore,
      confidence: run.final.confidence,
      statusPreview: run.final.statusSummary.slice(0, 280),
    };
  };

  console.log(JSON.stringify({ v1: summarize(v1, a), v2: summarize(v2, b) }, null, 2));
}

main();
