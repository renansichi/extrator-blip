import { readFile } from 'node:fs/promises';
import { Fault } from './model.js';
export const defaults = {
  headless: false, browserChannel: 'msedge', actionTimeoutMs: 30000, navigationTimeoutMs: 60000, downloadTimeoutMs: 120000,
  retryDelayMs: 10000, maxRetries: 3, discoveryDeadlineMs: 300000, maxDownloadBytes: 104857600,
  outputRoot: './saida', storageState: '.auth/session.json', manualLogin: true,
  selectors: {
    email: '#email-input', password: '#password', loginSubmit: '', loginNext: '', authError: '',
    authenticated: '', listingReady: '', listingEnd: '', listingTotal: '', nextPage: '', scrollContainer: '', loading: '',
    config: 'bds-tooltip[tooltip-text="Configuração"] bds-button-icon', general: 'input[value="Configurações gerais"]',
    variables: '#variablesForm div > item-body > div > key-value > form > ul > li > ng-form > key-value-item',
    owner: '#owner-identity div div input', formReady: '', emptyVariables: '', variableKeyInput: '', variableValueInput: '',
    exportAction: '', exportSteps: [] as string[]
  },
  variablesVerified: false, variablesComplete: false, staticListingVerified: false
};
export type Settings = typeof defaults;
export async function loadSettings(file?: string): Promise<Settings> {
  const configFile = file ?? 'blip.config.json';
  let raw;
  try { raw = JSON.parse(await readFile(configFile, 'utf8')); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Fault('CONFIGURACAO_NAO_ENCONTRADA', false, true);
    throw e;
  }
  if (Object.keys(raw).some(k => !(k in defaults)) || (raw.selectors && Object.keys(raw.selectors).some(k => !(k in defaults.selectors)))) throw new Fault('CONFIG_CHAVE_DESCONHECIDA');
  const c = { ...defaults, ...raw, selectors: { ...defaults.selectors, ...raw.selectors } };
  if (!['msedge','chrome','chromium'].includes(c.browserChannel)) throw new Fault('CONFIG_NAVEGADOR_INVALIDO');
  for (const k of ['actionTimeoutMs','navigationTimeoutMs','downloadTimeoutMs','retryDelayMs','maxRetries','discoveryDeadlineMs','maxDownloadBytes'] as const) if (!Number.isSafeInteger(c[k]) || c[k] < (k === 'maxRetries' ? 0 : 1)) throw new Fault('CONFIG_NUMERO_INVALIDO');
  if (c.maxRetries > 3 || c.retryDelayMs < 10000) throw new Fault('CONFIG_RETRY_INVALIDO');
  for (const k of ['headless','manualLogin','variablesVerified','variablesComplete','staticListingVerified'] as const) if (typeof c[k] !== 'boolean') throw new Fault('CONFIG_BOOLEANO_INVALIDO');
  for (const k of ['outputRoot','storageState'] as const) if (typeof c[k] !== 'string' || !c[k]) throw new Fault('CONFIG_CAMINHO_INVALIDO');
  for (const [k,v] of Object.entries(c.selectors)) if (k === 'exportSteps' ? !Array.isArray(v) || v.some(x => typeof x !== 'string' || !x) : typeof v !== 'string') throw new Fault('CONFIG_SELETOR_INVALIDO');
  return c;
}
