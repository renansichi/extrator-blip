import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify, isLosslessNumber } from 'lossless-json';
import { Fault, validateConfig, type FileRecord, type JsonConfig } from './model.js';
export const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
export function safeName(name: string) {
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '');
  if (!s || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)) s = `_${s}`;
  // Always append an identity hash: stable across discovery order and case-insensitive volumes.
  return `${s.slice(0, 60)}-${sha(name).slice(0, 12)}`;
}
export function inside(root: string, ...parts: string[]) {
  const target = path.resolve(root, ...parts), rel = path.relative(path.resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Fault('CAMINHO_FORA_DA_SAIDA', false, true);
  return target;
}
export async function atomicJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${stringify(data, undefined, 2)}\n`, { flag: 'wx' });
  await fs.rename(tmp, file);
}
export async function record(root: string, file: string): Promise<FileRecord> {
  const bytes = await fs.readFile(file);
  return { path: path.relative(root, file), bytes: bytes.length, sha256: sha(bytes) };
}
export async function readExport(file: string, max: number): Promise<object> {
  const stat = await fs.stat(file);
  if (!stat.size || stat.size > max) throw new Fault('TAMANHO_EXPORT_INVALIDO', true);
  let value: unknown;
  try { value = parse(new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file)).replace(/^\uFEFF/, '')); } catch { throw new Fault('JSON_EXPORT_INVALIDO', true); }
  if (!value || typeof value !== 'object' || isLosslessNumber(value)) throw new Fault('ESTRUTURA_EXPORT_INVALIDA', true);
  return value;
}
export async function publish(root: string, safe: string, config: JsonConfig) {
  validateConfig(config);
  const stage = inside(root, 'temporarios', randomUUID());
  await fs.mkdir(stage, { recursive: true });
  const names = [`fluxo-${safe}.json`, `${safe}-Variaveis_de_configuracao.json`];
  await atomicJson(path.join(stage, names[0]), config);
  await atomicJson(path.join(stage, names[1]), config.configuracoes_gerais.variaveis.variaveis_de_configuracao);
  validateConfig(parse(await fs.readFile(path.join(stage, names[0]), 'utf8')), config.configuracoes_gerais.variaveis.nome_bot);
  if (await fs.readFile(path.join(stage, names[1]), 'utf8') !== `${stringify(config.configuracoes_gerais.variaveis.variaveis_de_configuracao, undefined, 2)}\n`) throw new Fault('PUBLICACAO_DIVERGENTE', false, true);
  await fs.mkdir(inside(root, 'bots'), { recursive: true });
  const destination = inside(root, 'bots', safe);
  try { await fs.rename(stage, destination); } catch (e) { throw new Fault('PUBLICACAO_CONFLITO', false, true); }
  return { principal: await record(root, path.join(destination, names[0])), variaveis: await record(root, path.join(destination, names[1])) };
}
export async function verifyFiles(root: string, files: Record<string, FileRecord>, bot: string) {
  try {
    for (const key of ['principal','variaveis','original']) {
      const f = files[key]; if (!f) return false;
      const actual = await record(root, inside(root, f.path));
      if (actual.sha256 !== f.sha256 || actual.bytes !== f.bytes) return false;
    }
    const config = parse(await fs.readFile(inside(root, files.principal.path), 'utf8'));
    validateConfig(config, bot);
    const variables = parse(await fs.readFile(inside(root, files.variaveis.path), 'utf8'));
    return stringify(variables) === stringify(config.configuracoes_gerais.variaveis.variaveis_de_configuracao);
  } catch { return false; }
}
