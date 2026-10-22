/**
 * Maps GitHub repository reads onto the shared discovery and evidence models.
 * Provider-specific response fields stay in the client.
 */
import {
  normalizeMeasuredValue,
  type DiscoveryResult,
  type NormalizedEvidence,
} from '../provider-types';

export type GithubRepository = {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  htmlUrl: string;
  visibility: 'public' | 'private' | 'internal' | 'unknown';
};

export type GithubContentEntry = {
  name: string;
  path: string;
  type: string;
  size: number;
};

export function toServiceDiscovery(input: {
  tenantId: string;
  connectionId: string;
  repositories: readonly GithubRepository[];
  incomplete?: boolean;
}): DiscoveryResult {
  const warnings: string[] = [];
  if (input.repositories.length === 0) warnings.push('No repositories are available to this installation.');
  if (input.repositories.some((repository) => repository.archived)) warnings.push('An archived repository is included.');
  if (input.repositories.some((repository) => repository.disabled)) warnings.push('A disabled repository is included.');
  if (input.incomplete) warnings.push('The repository list is incomplete.');
  return {
    provider: 'GITHUB',
    tenantId: input.tenantId,
    connectionId: input.connectionId,
    discoveredResources: input.repositories.map((repository) => repository.fullName),
    requestedScopes: input.repositories.map((repository) => ({
      resource: `repository:${repository.fullName}`,
      operation: 'read' as const,
      readonly: true,
    })),
    warnings,
    status: input.incomplete ? 'PARTIAL' : 'DISCOVERED',
  };
}

export function normalizeGithubEvidence(input: {
  connectionId: string;
  repositoryCount: number | null;
  rootEntryCount: number | null;
}): NormalizedEvidence {
  const repository = normalizeMeasuredValue(input.repositoryCount, input.repositoryCount === null ? 'NOT_MEASURED' : 'AVAILABLE');
  const root = normalizeMeasuredValue(input.rootEntryCount, input.rootEntryCount === null ? 'NOT_MEASURED' : 'AVAILABLE');
  return {
    provider: 'GITHUB',
    connectionId: input.connectionId,
    readOnly: true,
    metrics: [
      { metric: 'github.repositoryCount', value: repository.value, availability: repository.availability },
      { metric: 'github.rootEntryCount', value: root.value, availability: root.availability },
    ],
  };
}
