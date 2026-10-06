/**
 * Maps a project reference to one allowlisted workspace.
 * It does not accept a filesystem path from the caller.
 */
import type { WorkspaceRef } from './agent-handoff';

const ALLOWED_WORKSPACES: Readonly<Record<string, string>> = {
  'mock-aisle': 'data/jury-product/workspaces/mock-aisle',
  're-review-fixture': 'data/jury-product/workspaces/re-review-fixture',
};

export function resolveAllowedWorkspace(ref: WorkspaceRef): string | null {
  const mapped = ALLOWED_WORKSPACES[ref.ref];
  if (!mapped) return null;
  if (mapped.startsWith('/') || mapped.startsWith('\\') || mapped.includes('..') || /^[a-zA-Z]:/.test(mapped)) return null;
  return mapped;
}
