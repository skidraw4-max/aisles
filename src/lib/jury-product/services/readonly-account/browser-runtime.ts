/**
 * I-044: real browser launcher for the READ_ONLY_ACCOUNT executor.
 * playwright-core + @sparticuz/chromium (serverless Chromium). Imported lazily so tests and unrelated routes never load
 * or extract the binary. The context is created with service workers blocked and downloads disabled, as required by
 * createBrowserObservationDriver.
 */
import { createBrowserObservationDriver, type PwContext, type PwPage, type PwRoute } from './browser-driver';
import type { ObservationDriver } from './executor';

export async function launchServerlessChromiumContext(): Promise<PwContext> {
  const [{ chromium }, sparticuz] = await Promise.all([import('playwright-core'), import('@sparticuz/chromium')]);
  const bin = sparticuz.default;
  const browser = await chromium.launch({ executablePath: await bin.executablePath(), args: bin.args, headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, javaScriptEnabled: true });
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
        await browser.close().catch(() => undefined);
      },
    };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

export function createServerlessObservationDriver(): ObservationDriver {
  return createBrowserObservationDriver(launchServerlessChromiumContext);
}
