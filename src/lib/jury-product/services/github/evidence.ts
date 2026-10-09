/**
 * GitHub collection becomes the existing EvidencePack and JuryEvidence.
 * Product metrics that GitHub did not measure stay null.
 */
import { createHash } from 'node:crypto';
import { EVIDENCE_METRIC_DEFINITIONS, type EvidencePack } from '@/lib/ai-review-board/types';
import type { BuiltJuryEvidence } from '../../evidence-builder';
import type { JuryAvailability, JuryEvidence, JuryNormalizedMetric } from '../../records';
import { normalizeMeasuredValue } from '../provider-types';
import type { GithubCollected } from './collector';

const RULE_ID = 'normalize.github.repository.v1';
const ADAPTER_KEY = 'github';
const ADAPTER_VERSION = 'github-readonly-v1';
const PURPOSE = 'github-repository-observation';
const EXCERPT = 4000;
const LIMIT_CODE = 'COLLECTION_LIMIT_EXCEEDED';

export type GithubStoredMetric = {
  metric: string;
  value: number | null;
  availability: JuryAvailability;
  rawValueText?: string | null;
};

function rawText(metric: string, value: number | null, collection: GithubCollected): string {
  const code = metric === 'github.readmeBytes'
    ? collection.readme.code
    : metric === 'github.commitCount'
      ? collection.commits.code
      : metric === 'github.structureEntryCount'
        ? collection.structure.code
        : undefined;
  if (code === LIMIT_CODE) return LIMIT_CODE;
  return value === null ? 'null' : String(value);
}

function metricRow(metrics: readonly GithubStoredMetric[], name: string): GithubStoredMetric | null {
  return metrics.find((metric) => metric.metric === name) ?? null;
}

export function githubObservationHints(input: {
  metrics: readonly GithubStoredMetric[];
  commitDocuments: number;
}): string[] {
  const commits = metricRow(input.metrics, 'github.commitCount');
  const readme = metricRow(input.metrics, 'github.readmeBytes');
  const structure = metricRow(input.metrics, 'github.structureEntryCount');
  const hints: string[] = [];
  if (commits?.availability === 'AVAILABLE' && typeof commits.value === 'number') {
    hints.push(`GitHub commit count is available: ${commits.value}.`);
    hints.push(`GitHub commit metadata documents: ${input.commitDocuments}.`);
  } else if (commits?.availability === 'COLLECTION_FAILED') {
    hints.push(commits.rawValueText === LIMIT_CODE
      ? 'GitHub commit collection failed because the read limit was exceeded.'
      : 'GitHub commit collection failed. Commit count was not measured.');
    hints.push(`GitHub commit metadata documents: ${input.commitDocuments}.`);
  } else if (commits) {
    hints.push('GitHub commit count is not available. It was not measured.');
    hints.push(`GitHub commit metadata documents: ${input.commitDocuments}.`);
  } else {
    hints.push('GitHub commit count was not included. It was not estimated from commit metadata.');
    hints.push(`GitHub commit metadata documents: ${input.commitDocuments}.`);
  }
  if (readme?.availability === 'AVAILABLE') {
    hints.push(readme.value === 0 ? 'GitHub README is empty.' : `GitHub README is available. Bytes ${readme.value}.`);
  } else if (readme?.availability === 'NOT_AVAILABLE') {
    hints.push('GitHub README is not available. This is absence, not a collection failure.');
  } else if (readme?.availability === 'COLLECTION_FAILED') {
    hints.push(readme.rawValueText === LIMIT_CODE
      ? 'GitHub README collection failed because the read limit was exceeded.'
      : 'GitHub README collection failed.');
  }
  if (structure?.availability === 'AVAILABLE' && typeof structure.value === 'number') {
    hints.push(`GitHub structure entries collected: ${structure.value}.`);
  } else if (structure?.availability === 'COLLECTION_FAILED') {
    hints.push(structure.rawValueText === LIMIT_CODE
      ? 'GitHub structure collection failed because the file size limit was exceeded. Code COLLECTION_LIMIT_EXCEEDED.'
      : 'GitHub structure collection failed.');
  } else if (structure) {
    hints.push('GitHub structure was not measured.');
  }
  hints.push('GitHub user, traffic, growth, and engagement metrics were not measured. Commit count is not a substitute for those metrics.');
  return hints;
}

export type GithubEvidenceView = {
  status: 'COLLECTED' | 'PARTIAL' | 'FAILED';
  repository: string;
  readme: 'AVAILABLE' | 'EMPTY' | 'NOT_AVAILABLE';
  commitCount: number | null;
  structureCount: number | null;
  readOnly: true;
};

export type GithubEvidenceDraft = {
  pack: EvidencePack;
  evidence: BuiltJuryEvidence;
  metrics: JuryNormalizedMetric[];
  view: GithubEvidenceView;
};

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

function seoulDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function measured(value: number | null, availability: JuryAvailability): { value: number | null; availability: JuryAvailability } {
  return normalizeMeasuredValue(value, availability);
}

export function githubEvidenceView(collection: GithubCollected): GithubEvidenceView {
  const readme = collection.readme.availability !== 'AVAILABLE'
    ? 'NOT_AVAILABLE'
    : collection.readme.value.bytes === 0
      ? 'EMPTY'
      : 'AVAILABLE';
  return {
    status: collection.status,
    repository: collection.repository.fullName,
    readme,
    commitCount: collection.commits.availability === 'AVAILABLE' ? collection.commits.value.length : null,
    structureCount: collection.structure.availability === 'AVAILABLE' ? collection.structure.value.length : null,
    readOnly: true,
  };
}

export function viewFromStoredMetrics(input: {
  repository: string;
  metrics: readonly { metric: string; value: number | null; availability: string }[];
}): GithubEvidenceView {
  const metric = (name: string) => input.metrics.find((row) => row.metric === name) ?? null;
  const readme = metric('github.readmeBytes');
  const commits = metric('github.commitCount');
  const structure = metric('github.structureEntryCount');
  const failed = input.metrics.some((row) => row.availability === 'COLLECTION_FAILED');
  return {
    status: failed ? 'PARTIAL' : 'COLLECTED',
    repository: input.repository,
    readme: readme?.availability === 'AVAILABLE' ? (readme.value === 0 ? 'EMPTY' : 'AVAILABLE') : 'NOT_AVAILABLE',
    commitCount: commits?.availability === 'AVAILABLE' && typeof commits.value === 'number' ? commits.value : null,
    structureCount: structure?.availability === 'AVAILABLE' && typeof structure.value === 'number' ? structure.value : null,
    readOnly: true,
  };
}

export function normalizeGithubCollection(input: {
  tenantId: string;
  collection: GithubCollected;
}): GithubEvidenceDraft {
  const { collection } = input;
  const repository = collection.repository;
  const day = seoulDay(collection.collectedAt);
  const size = measured(repository.sizeKb, repository.sizeKb === null ? 'NOT_MEASURED' : 'AVAILABLE');
  const commitCount = measured(
    collection.commits.availability === 'AVAILABLE' ? collection.commits.value.length : null,
    collection.commits.availability === 'AVAILABLE' ? 'AVAILABLE' : collection.commits.availability,
  );
  const readmeBytes = measured(
    collection.readme.availability === 'AVAILABLE' ? collection.readme.value.bytes : null,
    collection.readme.availability === 'AVAILABLE' ? 'AVAILABLE' : collection.readme.availability,
  );
  const structureCount = measured(
    collection.structure.availability === 'AVAILABLE' ? collection.structure.value.length : null,
    collection.structure.availability === 'AVAILABLE' ? 'AVAILABLE' : collection.structure.availability,
  );
  const issues = measured(null, 'NOT_AVAILABLE');
  const uncollectedRequests = measured(null, 'NOT_AVAILABLE');
  const rows = [
    ['github.repositorySizeKb', size],
    ['github.commitCount', commitCount],
    ['github.readmeBytes', readmeBytes],
    ['github.structureEntryCount', structureCount],
    ['github.openIssueCount', issues],
    ['github.openPullRequestCount', uncollectedRequests],
  ] as const;
  const metrics: JuryNormalizedMetric[] = rows.map(([metric, value]) => ({
    id: hash([input.tenantId, collection.connectionId, metric, collection.collectedAt, value.availability, value.value === null ? 'null' : String(value.value)]),
    tenantId: input.tenantId,
    connectionId: collection.connectionId,
    metric,
    value: value.value,
    unit: 'COUNT',
    periodStart: day,
    periodEnd: day,
    timezone: 'Asia/Seoul',
    sourceSystem: 'API',
    sourceRef: metric,
    collectedAt: collection.collectedAt,
    availability: value.availability,
    rawValueText: rawText(metric, value.value, collection),
    rawPayloadRef: `github:${metric}`,
    adapterKey: ADAPTER_KEY,
    adapterVersion: ADAPTER_VERSION,
    ruleId: RULE_ID,
  }));
  const excerpt = (collection.readme.value.text ?? '').slice(0, EXCERPT);
  const documents: NonNullable<BuiltJuryEvidence['documentEvidence']> = [
    {
      fileName: repository.fullName,
      section: [
        `visibility=${repository.visibility}`,
        `private=${repository.private}`,
        `defaultBranch=${repository.defaultBranch ?? 'not-available'}`,
        `archived=${repository.archived}`,
        `disabled=${repository.disabled}`,
      ].join(' '),
      source: 'github',
    },
  ];
  if (collection.readme.availability === 'AVAILABLE') {
    documents.push({
      fileName: collection.readme.value.name ?? 'README',
      section: excerpt,
      source: 'github',
    });
  }
  for (const commit of collection.commits.value) {
    documents.push({ fileName: `commit:${commit.sha}`, section: commit.message, source: 'github' });
  }
  for (const entry of collection.structure.value) {
    documents.push({
      fileName: entry.path,
      section: `${entry.type} ${entry.size}`,
      source: 'github',
    });
  }
  const hints = [
    `GitHub repository ${repository.fullName} visibility=${repository.visibility} private=${repository.private} defaultBranch=${repository.defaultBranch ?? 'not-available'} archived=${repository.archived} disabled=${repository.disabled}.`,
    repository.language ? `GitHub repository language is ${repository.language}.` : 'GitHub repository language was not measured.',
    size.availability === 'AVAILABLE' ? `GitHub repository size is ${size.value} KB.` : 'GitHub repository size was not measured.',
    ...githubObservationHints({
      metrics,
      commitDocuments: collection.commits.value.length,
    }),
    'GitHub open issue count was not collected.',
    'GitHub open pull request count was not collected.',
    'GitHub metadata does not measure users, traffic, growth, success, or engagement.',
    `provider=GITHUB connectionId=${collection.connectionId} repository=${repository.fullName} source=github collectedAt=${collection.collectedAt} readOnly=true`,
  ];
  const pack: EvidencePack = {
    generatedAt: collection.collectedAt,
    analysisPeriod: { start: day, end: day, timezone: 'Asia/Seoul' },
    site: {
      name: repository.fullName,
      corridors: [],
      stackNotes: repository.language ? [repository.language] : [],
    },
    aggregates: {
      userCount: null,
      usersLast7d: null,
      newUsersLast7d: null,
      activeUsersLast7d: null,
      postCount: null,
      postsLast7d: null,
      commentsLast7d: null,
      viewsLast7d: null,
      totalViews: null,
      commentCount: null,
      postsByCategory: {},
    },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: hints,
    piiExcluded: true,
    readOnly: true,
  };
  const evidenceId = hash([input.tenantId, collection.connectionId, day, ...metrics.map((metric) => metric.id), ...documents.map((item) => `${item.fileName}:${item.section ?? ''}`)]);
  const linked = metrics.map((metric) => ({ ...metric, evidenceId }));
  const evidence: BuiltJuryEvidence = {
    id: evidenceId,
    tenantId: input.tenantId,
    connectionId: collection.connectionId,
    purpose: PURPOSE,
    periodStart: day,
    periodEnd: day,
    timezone: 'Asia/Seoul',
    metricIds: linked.map((metric) => metric.id),
    apiEvidence: collection.requested.map((endpoint) => ({
      endpoint: `GET /repos/${repository.fullName}${endpoint === 'repository' ? '' : endpoint === 'structure' ? '/contents' : `/${endpoint}`}`,
      payloadRef: `github:${endpoint}`,
      requestedAt: collection.collectedAt,
    })),
    documentEvidence: documents,
    adapterKey: ADAPTER_KEY,
    collectedAt: collection.collectedAt,
    contentHash: hash(linked.map((metric) => `${metric.metric}:${metric.availability}:${metric.value === null ? 'null' : metric.value}`)),
    piiExcluded: true,
    readOnly: true,
  };
  return { pack, evidence, metrics: linked, view: githubEvidenceView(collection) };
}

export function packFromStoredEvidence(input: {
  evidence: JuryEvidence & { piiExcluded?: boolean; readOnly?: boolean };
  repository: string;
  metrics?: readonly GithubStoredMetric[];
}): EvidencePack | null {
  if (input.evidence.piiExcluded !== true || input.evidence.readOnly !== true) return null;
  if (input.evidence.timezone !== 'Asia/Seoul') return null;
  const documents = input.evidence.documentEvidence ?? [];
  const commitDocuments = documents.filter((item) => item.fileName.startsWith('commit:')).length;
  const hints = [
    ...githubObservationHints({ metrics: input.metrics ?? [], commitDocuments }),
    ...documents.flatMap((item) => {
      if (item.source !== 'github' || !item.section) return [];
      return [`${item.fileName}: ${item.section}`.slice(0, EXCERPT)];
    }),
  ];
  hints.push('GitHub metadata does not measure users, traffic, growth, success, or engagement.');
  return {
    generatedAt: input.evidence.collectedAt,
    analysisPeriod: { start: input.evidence.periodStart, end: input.evidence.periodEnd, timezone: 'Asia/Seoul' },
    site: { name: input.repository, corridors: [], stackNotes: [] },
    aggregates: {
      userCount: null,
      usersLast7d: null,
      newUsersLast7d: null,
      activeUsersLast7d: null,
      postCount: null,
      postsLast7d: null,
      commentsLast7d: null,
      viewsLast7d: null,
      totalViews: null,
      commentCount: null,
      postsByCategory: {},
    },
    metricDefinitions: EVIDENCE_METRIC_DEFINITIONS,
    docsHints: hints,
    piiExcluded: true,
    readOnly: true,
  };
}
