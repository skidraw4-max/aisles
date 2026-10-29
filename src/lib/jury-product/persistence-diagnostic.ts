/**
 * Sanitized persistence diagnostics for tests.
 * The user-facing reason stays PERSISTENCE_FAILED. This record omits queries and credentials.
 */
/** Preview discovery once ran 5301ms against the 5000ms default. These limits cover that path. */
export const JURY_INTERACTIVE_TRANSACTION: { maxWait: number; timeout: number } = {
  maxWait: 15_000,
  timeout: 15_000,
};

const DRIVER_KINDS = new Set([
  'ColumnNotFound',
  'TableDoesNotExist',
  'UniqueConstraintViolation',
  'NullConstraintViolation',
  'ForeignKeyConstraintViolation',
  'ConnectionClosed',
  'DatabaseNotReachable',
  'TooManyConnections',
  'TransactionWriteConflict',
  'LengthMismatch',
  'ValueOutOfRange',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function sqlStateValue(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9A-Z]{5}$/.test(value) ? value : null;
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) ? value : null;
}

function adapterCause(error: unknown): Record<string, unknown> | null {
  const meta = asRecord(asRecord(error)?.meta);
  const driver = asRecord(meta?.driverAdapterError);
  return asRecord(driver?.cause);
}

function diagnosticCode(error: unknown): string {
  const code = asRecord(error)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : '';
}

/** Postgres SQLSTATE only. Driver messages and meta.message can repeat the query, so they stay out of the log. */
function sqlState(error: unknown): string | null {
  const meta = asRecord(asRecord(error)?.meta);
  return sqlStateValue(meta?.code) ?? sqlStateValue(adapterCause(error)?.originalCode);
}

function driverKind(error: unknown): string | null {
  const kind = adapterCause(error)?.kind;
  return typeof kind === 'string' && DRIVER_KINDS.has(kind) ? kind : null;
}

export function notePersistenceFailure(operation: string, error: unknown): void {
  if (process.env.JURY_TEST_DIAGNOSTICS !== '1') return;
  const code = diagnosticCode(error);
  const errorClass = error instanceof Error ? error.name : 'Unknown';
  const message = error instanceof Error ? error.message : '';
  const elapsed = /however (\d+) ms passed/.exec(message);
  const limit = /was (\d+) ms/.exec(message);
  const cause = adapterCause(error);
  console.error(JSON.stringify({
    diagnostic: 'persistence',
    operation,
    errorClass,
    code: code || null,
    sqlState: sqlState(error),
    driverKind: driverKind(error),
    column: identifier(cause?.column),
    table: identifier(cause?.table),
    timeout: code === 'P2028',
    elapsedMs: elapsed ? Number(elapsed[1]) : null,
    limitMs: limit ? Number(limit[1]) : null,
  }));
}
