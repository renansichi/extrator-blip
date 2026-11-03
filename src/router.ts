import { Fault, type Candidate } from './model.js';
export const baseUrl = 'https://macro.blip.ai';
export function identifier(input: string): string {
  if (!input.trim() || input === '.' || input === '..' || /[\\/\u0000-\u001f\u007f]/u.test(input)) throw new Fault('IDENTIFICADOR_INVALIDO');
  return input;
}
export function scopedUrl(input: string, base = baseUrl): URL {
  const u = new URL(input, base);
  if (u.origin !== baseUrl || u.username || u.password) throw new Fault('URL_FORA_DO_ESCOPO');
  return u;
}
export function routerIdentifier(input: string): string {
  if (!input.includes('://')) return identifier(input);
  const u = scopedUrl(input);
  const m = u.pathname.match(/^\/application\/detail\/([^/]+)(?:\/|$)/);
  if (!m) throw new Fault('URL_ROUTER_INVALIDA');
  return identifier(decodeURIComponent(m[1]));
}
export const routerUrl = (id: string) => `${baseUrl}/application/detail/${encodeURIComponent(identifier(id))}/template/master/`;
export function parseBotCandidate(input: string): Candidate {
  const u = scopedUrl(input);
  const m = u.pathname.match(/^\/application\/detail\/([^/]+)(?:\/template\/[^/]+)?\/dashboard\/general\/?$/);
  if (!m) throw new Fault('URL_BOT_INESPERADA');
  const nome_bot = identifier(decodeURIComponent(m[1]));
  u.pathname = u.pathname.replace(/\/dashboard\/general\/?$/, '/templates/builder');
  u.search = ''; u.hash = '';
  return { nome_bot, source_url: input, builder_url: u.href };
}
export function assertIdentity(url: string, bot: string) {
  const u = scopedUrl(url);
  if (u.pathname.includes('/login')) throw new Fault('SESSAO_EXPIRADA', true);
  const m = u.pathname.match(/^\/application\/detail\/([^/]+)\/(?:template\/|templates\/builder\/?$)/);
  if (!m || decodeURIComponent(m[1]) !== bot) throw new Fault('IDENTIDADE_DIVERGENTE');
}
