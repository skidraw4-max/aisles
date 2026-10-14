/**
 * Maps a product lineage workspace to the workspace Change Gate may inspect.
 * It does not read the allowlist or the filesystem.
 */
import type { WorkspaceRef } from './agent-handoff';

const PRODUCT_LINEAGE_REF = 'jury-product';
const MOCK_INSPECTION_REF = 'mock-aisle';

export function inspectionWorkspaceForProduct(lineage: WorkspaceRef): WorkspaceRef | null {
  if (lineage.type !== 'PROJECT' || lineage.ref !== PRODUCT_LINEAGE_REF) return null;
  return { type: 'PROJECT', ref: MOCK_INSPECTION_REF };
}
