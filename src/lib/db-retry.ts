const CONNECTION_ERROR_RE =
  /max client connections|EMAXCONN|too many clients|connection terminated|connection timeout|timeout exceeded|ECONNREFUSED|ETIMEDOUT|pool exhausted/i;

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const parts = [error.message, error.name, (error as { code?: string }).code]
    .filter(Boolean)
    .join(' ');
  return CONNECTION_ERROR_RE.test(parts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 서버리스 스파이크 시 풀 고갈·일시 연결 오류에 짧게 재시도 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; baseDelayMs?: number }
): Promise<T> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 80;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isConnectionError(error) || i === attempts - 1) throw error;
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastError;
}
