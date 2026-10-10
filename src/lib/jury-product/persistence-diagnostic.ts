/**
 * Sanitized persistence diagnostics for tests.
 * The user-facing reason stays PERSISTENCE_FAILED. This record omits queries and credentials.
 */
/** Preview discovery once ran 5301ms against the 5000ms default. These limits cover that path. */
export const JURY_INTERACTIVE_TRANSACTION: { maxWait: number; timeout: number } = {
  maxWait: 15_000,
  timeout: 15_000,
};

export function notePersistenceFailure(operation: string, error: unknown): void {
  if (process.env.JURY_TEST_DIAGNOSTICS !== '1') return;
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  const errorClass = error instanceof Error ? error.name : 'Unknown';
  const message = error instanceof Error ? error.message : '';
  const elapsed = /however (\d+) ms passed/.exec(message);
  const limit = /was (\d+) ms/.exec(message);
  console.error(JSON.stringify({
    diagnostic: 'persistence',
    operation,
    errorClass,
    code: code || null,
    timeout: code === 'P2028',
    elapsedMs: elapsed ? Number(elapsed[1]) : null,
    limitMs: limit ? Number(limit[1]) : null,
  }));
}
