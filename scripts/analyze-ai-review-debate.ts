/**
 * One-shot debate/revision metrics for a preserved sample run (read-only).
 * Usage: npx tsx scripts/analyze-ai-review-debate.ts [runId]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

type Ind = {
  memberId: string;
  originalOpinion: string;
  problems: string[];
  strengths: string[];
  confidence: number;
  scores: { dimension: string; score: number | null; evidence: { kind: string }[] }[];
};

type Deb = {
  memberId: string;
  agreement: string[];
  disagreement: string[];
  weakEvidence: string[];
  missed: string[];
  needsVerification: string[];
  revisionStatus?: 'UNCHANGED' | 'PARTIAL' | 'FULL';
  revised?: boolean;
  revisionReason?: string | null;
  previousOpinion?: string | null;
  revisedOpinion?: string | null;
  finalOpinion?: string;
  confidence?: number;
};

type Rev = {
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
};

async function main() {
  const runId = process.argv[2] || 'run-2026-09-17T07-53-24-323Z';
  const dir = path.join(process.cwd(), 'data', 'ai-review-board', runId);
  const independent = JSON.parse(
    await fs.readFile(path.join(dir, 'independent-analysis.json'), 'utf8'),
  ) as Ind[];
  const debate = JSON.parse(await fs.readFile(path.join(dir, 'debate.json'), 'utf8')) as Deb[];
  let revisions: Rev[] | null = null;
  try {
    revisions = JSON.parse(await fs.readFile(path.join(dir, 'revisions.json'), 'utf8')) as Rev[];
  } catch {
    revisions = null;
  }
  const critic = JSON.parse(await fs.readFile(path.join(dir, 'critic.json'), 'utf8')) as {
    herdingDetected?: boolean;
    notes?: string[];
    overclaiming?: { ok: boolean; flags: string[] };
    herding?: { ok: boolean; flags: string[] };
    fabrication?: { ok: boolean; flags: string[] };
  };

  const opinions = independent.map((i) => i.originalOpinion.trim());
  const uniqueOpinions = new Set(opinions.map((o) => o.slice(0, 120)));
  const agreementCount = debate.reduce((n, d) => n + d.agreement.length, 0);
  const disagreementCount = debate.reduce((n, d) => n + d.disagreement.length, 0);
  const weakEvidenceCount = debate.reduce((n, d) => n + d.weakEvidence.length, 0);
  const missedCount = debate.reduce((n, d) => n + d.missed.length, 0);
  const needsVerCount = debate.reduce((n, d) => n + d.needsVerification.length, 0);

  const source = revisions && revisions.length > 0 ? revisions : null;
  const revisionCount = source
    ? source.filter((d) => d.revised || d.revisionStatus === 'PARTIAL' || d.revisionStatus === 'FULL')
        .length
    : debate.filter((d) => d.revised || d.revisionStatus === 'PARTIAL' || d.revisionStatus === 'FULL')
        .length;
  const partialRevisionCount = source
    ? source.filter((d) => d.revisionStatus === 'PARTIAL').length
    : debate.filter((d) => d.revisionStatus === 'PARTIAL').length;
  const fullRevisionCount = source
    ? source.filter((d) => d.revisionStatus === 'FULL').length
    : debate.filter((d) => d.revisionStatus === 'FULL').length;
  const unchangedCount = source
    ? source.filter((d) => d.revisionStatus === 'UNCHANGED').length
    : debate.filter((d) => d.revisionStatus === 'UNCHANGED' || (!d.revisionStatus && !d.revised))
        .length;

  const avgConfInd =
    independent.reduce((s, i) => s + i.confidence, 0) / Math.max(1, independent.length);
  const avgConfDeb = debate.some((d) => typeof d.confidence === 'number')
    ? debate.reduce((s, d) => s + (d.confidence ?? 0), 0) / Math.max(1, debate.length)
    : null;

  const report = {
    runId,
    revisionSource: source ? 'revisions.json' : 'debate.json',
    usedCallsHint: source ? 17 : 12,
    initialOpinionDiversity: {
      members: independent.length,
      uniqueOpinionPrefixes: uniqueOpinions.size,
    },
    debateMetrics: {
      agreementCount,
      disagreementCount,
      weakEvidenceCount,
      missedCount,
      needsVerificationCount: needsVerCount,
      revisionCount,
      partialRevisionCount,
      fullRevisionCount,
      unchangedCount,
    },
    confidence: {
      avgIndependent: avgConfInd,
      avgDebate: avgConfDeb,
      revisionDeltas: source
        ? source.map((r) => ({
            memberId: r.memberId,
            before: r.confidenceBefore,
            after: r.confidenceAfter,
            delta: Number((r.confidenceAfter - r.confidenceBefore).toFixed(3)),
          }))
        : null,
    },
    critic: {
      herdingDetected: critic.herdingDetected,
      overclaiming: critic.overclaiming,
      herding: critic.herding,
      fabrication: critic.fabrication,
      notes: critic.notes,
    },
    perMemberRevision: (source ?? []).map((d) => ({
      memberId: d.memberId,
      revisionStatus: d.revisionStatus,
      revised: d.revised,
      retainReason: d.retainReason?.slice(0, 200) ?? null,
      revisionReason: d.revisionReason?.slice(0, 200) ?? null,
      changedClaims: d.changedClaims,
      confidenceBefore: d.confidenceBefore,
      confidenceAfter: d.confidenceAfter,
      originalPreview: d.originalOpinion.slice(0, 140),
      finalPreview: d.finalOpinion.slice(0, 140),
    })),
    perMemberDebate: debate.map((d) => ({
      memberId: d.memberId,
      agreement: d.agreement.length,
      disagreement: d.disagreement.length,
      weakEvidence: d.weakEvidence.length,
      disagreementPreview: d.disagreement.slice(0, 2),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
