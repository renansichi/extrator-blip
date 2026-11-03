import type { Page, Locator } from 'playwright';
import type { Settings } from './config.js';
import { Fault, type Candidate, type Variable } from './model.js';
import { assertIdentity, parseBotCandidate } from './router.js';
export async function uniqueVisible(locator: Locator): Promise<Locator> {
  const visible: Locator[] = [];
  for (const item of await locator.all()) if (await item.isVisible()) visible.push(item);
  if (visible.length !== 1) throw new Fault(visible.length ? 'CONTROLE_AMBIGUO' : 'CONTROLE_NAO_VISIVEL');
  return visible[0];
}
export class PortalAdapter {
  constructor(public settings: Settings) {}
  async ready(page: Page, selector: string) {
    if (!selector) throw new Fault('ADAPTADOR_EXIGE_INSPECAO', false, true);
    await page.locator(selector).waitFor({ state: 'visible' });
    if (this.settings.selectors.loading) await page.locator(this.settings.selectors.loading).waitFor({ state: 'hidden' });
  }
  async discover(page: Page) {
    const s = this.settings.selectors;
    await this.ready(page, s.listingReady);
    const bots = new Map<string, Candidate>();
    const deadline = Date.now() + this.settings.discoveryDeadlineMs;
    let evidence: string | null = null, total: number | null = null;
    while (Date.now() < deadline) {
      const hrefs = await page.locator('a[href*="dashboard/general"]').evaluateAll(nodes => nodes.map(n => (n as HTMLAnchorElement).href));
      for (const href of hrefs) {
        const c = parseBotCandidate(href), previous = bots.get(c.nome_bot);
        if (previous && previous.builder_url !== c.builder_url) throw new Fault('DESTINOS_AMBIGUOS', false, true);
        bots.set(c.nome_bot, c);
      }
      if (s.listingTotal) {
        const text = await (await uniqueVisible(page.locator(s.listingTotal))).innerText();
        if (!/^\s*\d+\s*$/.test(text)) throw new Fault('TOTAL_PORTAL_INVALIDO');
        total = Number(text.trim());
        if (bots.size > total) throw new Fault('TOTAL_PORTAL_DIVERGENTE');
        if (bots.size === total) { evidence = 'total_portal_conciliado'; break; }
      }
      if (s.listingEnd && await page.locator(s.listingEnd).isVisible()) { evidence = 'indicador_fim_verificado'; break; }
      if (this.settings.staticListingVerified) {
        const rows = await page.locator('.services-list application-item:not([single-form])').count();
        if (rows === bots.size && rows > 0) evidence = 'listagem_estatica_inspecionada_linhas_conciliadas';
        break;
      }
      if (s.nextPage) {
        const next = await uniqueVisible(page.locator(s.nextPage));
        if (await next.isDisabled() || await next.getAttribute('aria-disabled') === 'true') { evidence = 'ultima_pagina'; break; }
        const before = JSON.stringify(hrefs);
        await next.click();
        await page.waitForFunction(({ before }) => JSON.stringify(Array.from(document.querySelectorAll('a[href*="dashboard/general"]'), n => (n as HTMLAnchorElement).href)) !== before, { before });
        await this.ready(page, s.listingReady);
        continue;
      }
      if (s.scrollContainer) {
        const container = await uniqueVisible(page.locator(s.scrollContainer));
        await container.evaluate(el => { el.scrollTop += Math.max(1, el.clientHeight * 0.8); });
        await page.waitForTimeout(300);
        await this.ready(page, s.listingReady);
        continue;
      }
      break;
    }
    if (total !== null && total !== bots.size) evidence = null;
    return { bots: [...bots.values()], completa: evidence !== null, evidencia_fim: evidence, total_informado_portal: total, total_unicos: bots.size };
  }
  async snapshot(page: Page, bot: string) {
    const s = this.settings.selectors;
    assertIdentity(page.url(), bot);
    if (!await page.locator(s.general).isVisible()) {
      await page.locator(s.config).waitFor({ state: 'visible' });
      await (await uniqueVisible(page.locator(s.config))).click();
    }
    await this.ready(page, s.general);
    await this.ready(page, s.formReady);
    if (!this.settings.variablesVerified || !this.settings.variablesComplete) throw new Fault('VARIAVEIS_EXIGEM_VALIDACAO_ASSISTIDA', false, true);
    const read = () => page.evaluate(s => {
      const owners = document.querySelectorAll<HTMLInputElement>(s.owner);
      const items = Array.from(document.querySelectorAll(s.variables));
      return {
        id: owners.length === 1 ? owners[0].value : null,
        variables: items.map(el => {
          const keyInput = s.variableKeyInput ? el.querySelector<HTMLInputElement>(s.variableKeyInput) : null;
          const valueInput = s.variableValueInput ? el.querySelector<HTMLInputElement>(s.variableValueInput) : null;
          return { key: s.variableKeyInput ? keyInput?.value ?? null : el.getAttribute('key'), value: s.variableValueInput ? valueInput?.value ?? null : el.getAttribute('value') };
        })
      };
    }, s);
    let previous = await read();
    const deadline = Date.now() + this.settings.actionTimeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(250);
      const current = await read();
      if (JSON.stringify(previous) === JSON.stringify(current)) {
        if (!current.id?.trim() || current.variables.some(v => v.key === null || !v.key.trim() || v.value === null)) throw new Fault('SNAPSHOT_INVALIDO');
        if (!current.variables.length && (!s.emptyVariables || !await page.locator(s.emptyVariables).isVisible())) throw new Fault('VARIAVEIS_VAZIAS_SEM_EVIDENCIA');
        assertIdentity(page.url(), bot);
        return { id: current.id, variables: current.variables as Variable[] };
      }
      previous = current;
    }
    throw new Fault('FORMULARIO_INSTAVEL', true);
  }
  async exportAction(page: Page, bot: string) {
    for (const selector of this.settings.selectors.exportSteps) await (await uniqueVisible(page.locator(selector))).click();
    assertIdentity(page.url(), bot);
    const action = this.settings.selectors.exportAction ? page.locator(this.settings.selectors.exportAction) : page.locator('bds-typo').filter({ hasText: /^\s*Baixar fluxo\s*$/ });
    await action.waitFor({ state: 'visible' });
    return uniqueVisible(action);
  }
}
