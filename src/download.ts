import type { Page, Locator } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Fault } from './model.js';
import { assertIdentity } from './router.js';
export async function captureDownload(page: Page, action: Locator, bot: string, file: string, timeout: number) {
  assertIdentity(page.url(), bot);
  await mkdir(path.dirname(file), { recursive: true });
  const pending = page.waitForEvent('download', { timeout });
  // Attach rejection handler immediately; closing the failed attempt settles the listener.
  const settled = pending.then(value => ({ value }), error => ({ error }));
  try { await action.click(); } catch (error) { await page.close(); await settled; throw error; }
  const result = await settled;
  if ('error' in result) throw new Fault('DOWNLOAD_NAO_INICIOU', true);
  if (await result.value.failure()) throw new Fault('DOWNLOAD_FALHOU', true);
  assertIdentity(page.url(), bot);
  await result.value.saveAs(file);
}
