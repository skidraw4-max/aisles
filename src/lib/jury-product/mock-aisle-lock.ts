/**
 * Serializes the single allowlisted mock-aisle workspace.
 * The product allowlist still accepts only that path. Tests must not delete any other directory.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { open, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LOCK = path.join(tmpdir(), 'aisle-mock-aisle.lock');
const STALE_MS = 20 * 60 * 1000;
const storage = new AsyncLocalStorage<true>();

export function mockAisleAbsolute(): string {
  return path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces', 'mock-aisle');
}

async function acquire(): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(LOCK, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
      if (code !== 'EEXIST' && code !== 'EBUSY' && code !== 'EPERM') throw error;
      try {
        const info = await stat(LOCK);
        if (Date.now() - info.mtimeMs > STALE_MS) await unlink(LOCK);
      } catch {
        // The owner removed the lock between stat and unlink.
      }
      if (Date.now() - started > STALE_MS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

async function release(): Promise<void> {
  await unlink(LOCK).catch(() => undefined);
}

export async function withMockAisleLock<T>(fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return fn();
  await acquire();
  try {
    return await storage.run(true, fn);
  } finally {
    await release();
  }
}

export async function removeMockAisleWorkspace(): Promise<void> {
  const target = mockAisleAbsolute();
  const parent = path.resolve(process.cwd(), 'data', 'jury-product', 'workspaces');
  if (path.dirname(target) !== parent || path.basename(target) !== 'mock-aisle') {
    throw new Error('workspace cleanup refused');
  }
  await withMockAisleLock(async () => {
    let last: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rm(target, { recursive: true, force: true });
        return;
      } catch (error) {
        last = error;
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
        if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw last;
  });
}
