/**
 * I-044: real browser launcher for the READ_ONLY_ACCOUNT executor.
 * playwright-core + @sparticuz/chromium (serverless Chromium). Imported lazily so tests and unrelated routes never load
 * or extract the binary. The context is created with service workers blocked and downloads disabled, as required by
 * createBrowserObservationDriver.
 */
import { createBrowserObservationDriver, type PwContext, type PwPage, type PwRoute } from './browser-driver';
import type { ObservationDriver } from './executor';
import { createHostCheck } from './net-guard';
import type { MobileDevice } from '../screen-audit/viewports';

/**
 * I-068: the serverless Chromium font pack has Latin only (Korean renders as tofu). Copy the bundled Noto Sans KR into
 * /tmp/fonts (scanned by its fonts.conf) after executablePath() and before launch. Best effort; never throws.
 */
export const BUNDLED_FONT_FILES = ['assets/fonts/NotoSansKR-Regular.otf'] as const;
export async function installBundledFonts(targetDir = '/tmp/fonts', root = process.cwd()): Promise<number> {
  const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  let copied = 0;
  await fs.mkdir(targetDir, { recursive: true }).catch(() => undefined);
  for (const rel of BUNDLED_FONT_FILES) {
    const dest = path.join(targetDir, path.basename(rel));
    try {
      await fs.access(dest);
      copied += 1;
      continue;
    } catch {
      /* not yet */
    }
    try {
      await fs.copyFile(path.join(root, rel), dest);
      copied += 1;
    } catch {
      /* font missing: audit continues; contrast/text checks may be environment-limited */
    }
  }
  return copied;
}

type RawContext = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright-core')['chromium']['launch']>>['newContext']>>;
function wrapContext(context: RawContext, extra: { fork?: (d: MobileDevice) => Promise<PwContext>; onClose?: () => Promise<void> }): PwContext {
  return {
    route: async (url: string, handler: (route: PwRoute) => Promise<void> | void) => {
      await context.route(url, (route) => handler(route as unknown as PwRoute));
    },
    addInitScript: async (script: { content: string }) => {
      await context.addInitScript(script);
    },
    newPage: async () => (await context.newPage()) as unknown as PwPage,
    close: async () => {
      await context.close().catch(() => undefined);
      if (extra.onClose) await extra.onClose();
    },
    ...(extra.fork ? { forkMobile: extra.fork } : {}),
  };
}

export async function launchServerlessChromiumContext(): Promise<PwContext> {
  const [{ chromium }, sparticuz] = await Promise.all([import('playwright-core'), import('@sparticuz/chromium')]);
  const bin = sparticuz.default;
  const executablePath = await bin.executablePath();
  await installBundledFonts();
  const browser = await chromium.launch({ executablePath, args: bin.args, headless: true });
  try {
    const base = { serviceWorkers: 'block' as const, acceptDownloads: false, javaScriptEnabled: true };
    const context = await browser.newContext({ ...base, locale: 'ko-KR' });
    const fork = async (d: MobileDevice): Promise<PwContext> => {
      const storageState = await context.storageState();
      const mobile = await browser.newContext({
        ...base,
        storageState,
        viewport: { ...d.viewport },
        userAgent: d.userAgent,
        deviceScaleFactor: d.deviceScaleFactor,
        isMobile: d.isMobile,
        hasTouch: d.hasTouch,
        locale: d.locale,
      });
      return wrapContext(mobile, {});
    };
    return wrapContext(context, { fork, onClose: async () => void (await browser.close().catch(() => undefined)) });
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export function createServerlessObservationDriver(): ObservationDriver {
  // I-057: every request host must resolve to public addresses only (private IP / metadata blocked).
  return createBrowserObservationDriver(launchServerlessChromiumContext, { hostCheck: createHostCheck().check });
}
