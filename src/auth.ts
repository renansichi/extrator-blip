import type { Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Settings } from './config.js';
import { Fault } from './model.js';
import { uniqueVisible } from './portal-adapter.js';
import { errorCode } from './retry.js';
export type Intervention = () => Promise<void>;
export async function authenticate(page: Page, destination: string, settings: Settings, intervene: Intervention) {
  const s = settings.selectors;
  if (!s.authenticated) throw new Fault('AUTENTICACAO_EXIGE_INDICADOR_VERIFICADO', false, true);
  const navigate = async (url: string) => {
    if (page.isClosed()) throw new Fault('NAVEGADOR_OU_ABA_FECHADO', false, true);
    try { await page.goto(url, { waitUntil: 'domcontentloaded' }); }
    catch (e) { throw new Fault(`AUTENTICACAO_${errorCode(e)}`, false, true); }
  };
  await navigate(destination);
  // The SPA renders after DOMContentLoaded. An immediate isVisible() can discard
  // a valid saved session and send the page into a second login navigation.
  const initial = await Promise.any([
    page.locator(s.authenticated).waitFor({ state: 'visible' }).then(() => 'authenticated'),
    page.locator(s.email).waitFor({ state: 'visible' }).then(() => 'login')
  ]).catch(() => { throw new Fault('AUTENTICACAO_TELA_NAO_RECONHECIDA', false, true); });
  if (initial === 'authenticated' && new URL(page.url()).origin === 'https://macro.blip.ai' && !new URL(page.url()).pathname.includes('/login')) {
    await mkdir(path.dirname(settings.storageState), { recursive: true });
    await page.context().storageState({ path: settings.storageState });
    return;
  }
  if (settings.manualLogin) await intervene();
  else {
    if (!process.env.BLIP_EMAIL || !process.env.BLIP_PASSWORD) throw new Fault('CREDENCIAIS_NAO_CONFIGURADAS', false, true);
    await page.locator(s.email).fill(process.env.BLIP_EMAIL);
    if (!await page.locator(s.password).isVisible()) {
      if (!s.loginNext) throw new Fault('LOGIN_AVANCO_EXIGE_INSPECAO', false, true);
      await (await uniqueVisible(page.locator(s.loginNext))).click();
    }
    await page.locator(s.password).fill(process.env.BLIP_PASSWORD);
    if (!s.loginSubmit) throw new Fault('LOGIN_SUBMIT_EXIGE_INSPECAO', false, true);
    await (await uniqueVisible(page.locator(s.loginSubmit))).click();
    if (s.authError && await page.locator(s.authError).isVisible()) throw new Fault('CREDENCIAIS_RECUSADAS', false, true);
    try { await page.locator(s.authenticated || '__unverified_auth__').waitFor({ state: 'visible' }); }
    catch (authError) {
      if (errorCode(authError) !== 'TIMEOUT') throw new Fault(`AUTENTICACAO_${errorCode(authError)}`, false, true);
      if (!process.stdin.isTTY) throw new Fault('AUTENTICACAO_NAO_CONFIRMADA_INTERVENCAO_NECESSARIA', false, true);
      await intervene();
    }
  }
  if (page.isClosed()) throw new Fault('NAVEGADOR_OU_ABA_FECHADO', false, true);
  // Wait for the login redirect to finish before navigating to the router.
  try {
    await page.waitForURL(url => url.origin === 'https://macro.blip.ai' && !url.pathname.includes('/login'), { waitUntil: 'domcontentloaded' });
  } catch (e) { throw new Fault(`LOGIN_RETORNO_${errorCode(e)}`, false, true); }
  await navigate(destination);
  if (!s.authenticated) throw new Fault('AUTENTICACAO_EXIGE_INDICADOR_VERIFICADO', false, true);
  await page.locator(s.authenticated).waitFor({ state: 'visible' });
  if (new URL(page.url()).origin !== 'https://macro.blip.ai' || new URL(page.url()).pathname.includes('/login')) throw new Fault('AUTENTICACAO_NAO_CONFIRMADA', false, true);
  await mkdir(path.dirname(settings.storageState), { recursive: true });
  await page.context().storageState({ path: settings.storageState });
}
