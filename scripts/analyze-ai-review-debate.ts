/**
 * One-shot debate metrics for a preserved sample run (read-only).
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
  revised: boolean;
  revisionReason: string | null;
  previousOpinion: string | null;
  revisedOpinion: string | null;
  finalOpinion: string;
  confidence: number;
};

async function main() {
  const runId = process.argv[2] || 'run-2026-09-17T07-53-24-323Z';
  const dir = path.join(process.cwd(), 'data', 'ai-review-board', runId);
  const independent = JSON.parse(
    await fs.readFile(path.join(dir, 'independent-analysis.json'), 'utf8'),
  ) as Ind[];
  const debate = JSON.parse(await fs.readFile(path.join(dir, 'debate.json'), 'utf8')) as Deb[];
  const critic = JSON.parse(await fs.readFile(path.join(dir, 'critic.json'), 'utf8')) as {
    herdingDetected?: boolean;
    notes?: string[];
  };

  const opinions = independent.map((i) => i.originalOpinion.trim());
  const uniqueOpinions = new Set(opinions.map((o) => o.slice(0, 120)));
  const agreementCount = debate.reduce((n, d) => n + d.agreement.length, 0);
  const disagreementCount = debate.reduce((n, d) => n + d.disagreement.length, 0);
  const weakEvidenceCount = debate.reduce((n, d) => n + d.weakEvidence.length, 0);
  const missedCount = debate.reduce((n, d) => n + d.missed.length, 0);
  const needsVerCount = debate.reduce((n, d) => n + d.needsVerification.length, 0);
  const revisionCount = debate.filter((d) =>
    d.revisionStatus === 'PARTIAL' || d.revisionStatus === 'FULL' || d.revised,
  ).length;
  const partialRevisionCount = debate.filter((d) => d.revisionStatus === 'PARTIAL').length;
  const fullRevisionCount = debate.filter((d) => d.revisionStatus === 'FULL').length;
  const unchangedCount = debate.filter(
    (d) => d.revisionStatus === 'UNCHANGED' || (!d.revisionStatus && !d.revised),
  ).length;
  const avgConfInd =
    independent.reduce((s, i) => s + i.confidence, 0) / Math.max(1, independent.length);
  const avgConfDeb = debate.reduce((s, d) => s + d.confidence, 0) / Math.max(1, debate.length);

  let scored = 0;
  let evidenceBacked = 0;
  let totalScores = 0;
  for (const i of independent) {
    for (const s of i.scores) {
      totalScores += 1;
      if (s.score !== null) scored += 1;
      const hard = (s.evidence || []).some(
        (e) => e.kind === 'observation' || e.kind === 'metric' || e.kind === 'doc',
      );
      if (s.score !== null && hard) evidenceBacked += 1;
    }
  }

  const problemSets = independent.map((i) => new Set(i.problems.map((p) => p.toLowerCase().slice(0, 40))));
  let overlapPairs = 0;
  let pairCount = 0;
  for (let a = 0; a < problemSets.length; a++) {
    for (let b = a + 1; b < problemSets.length; b++) {
      pairCount += 1;
      const inter = [...problemSets[a]!].filter((x) => problemSets[b]!.has(x));
      if (inter.length > 0) overlapPairs += 1;
    }
  }

  const report = {
    runId,
    initialOpinionDiversity: {
      members: independent.length,
      uniqueOpinionPrefixes: uniqueOpinions.size,
      note: 'prefix uniqueness is coarse; check foci A–E qualitatively',
    },
    fociSummary: independent.map((i) => ({
      memberId: i.memberId,
      problemCount: i.problems.length,
      strengthCount: i.strengths.length,
      confidence: i.confidence,
      originalOpinionPreview: i.originalOpinion.slice(0, 160),
    })),
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
      rebuttalProxy: disagreementCount + weakEvidenceCount,
      evidenceChallengeCount: weakEvidenceCount,
    },
    confidence: { avgIndependent: avgConfInd, avgDebate: avgConfDeb },
    evidenceBackedClaimRatio: {
      scoredDimensions: scored,
      evidenceBackedScored: evidenceBacked,
      totalDimensionSlots: totalScores,
      ratioScoredEvidenceBacked: scored ? evidenceBacked / scored : null,
    },
    problemStatementExactOverlapPairs: { overlapPairs, pairCount },
    critic: { herdingDetected: critic.herdingDetected, notes: critic.notes },
    perMemberDebate: debate.map((d) => ({
      memberId: d.memberId,
      revisionStatus: d.revisionStatus ?? (d.revised ? 'PARTIAL?' : 'UNCHANGED?'),
      revised: d.revised,
      revisionReason: d.revisionReason,
      agreement: d.agreement.length,
      disagreement: d.disagreement.length,
      weakEvidence: d.weakEvidence.length,
      confidence: d.confidence,
      disagreementPreview: d.disagreement.slice(0, 2),
    })),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
