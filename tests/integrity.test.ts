import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stringify } from 'lossless-json';
import { identifier, routerIdentifier, parseBotCandidate, assertIdentity } from '../src/router.js';
import { inside, safeName, publish, record, verifyFiles, readExport } from '../src/storage.js';
import { createJsonConfig, validateConfig, Fault } from '../src/model.js';
import { withRetry, errorCode } from '../src/retry.js';
test('diagnóstico de login identifica erros sem reproduzir dados sensíveis', () => {
  assert.equal(errorCode(new Error('page.goto: Target page, context or browser has been closed')), 'NAVEGADOR_OU_ABA_FECHADO');
  assert.equal(errorCode(new Error('page.goto: net::ERR_ABORTED at https://example.test/?token=secret')), 'NAVEGACAO_INTERROMPIDA');
  assert.equal(errorCode(Object.assign(new Error('secret'), { code: 'ERR_USE_AFTER_CLOSE' })), 'TERMINAL_ENTRADA_FECHADA');
});
test('URLs reais e planejadas, domínio, codificação e identidade', () => {
  assert.equal(parseBotCandidate('/application/detail/bot/dashboard/general').builder_url, 'https://macro.blip.ai/application/detail/bot/templates/builder');
  assert.equal(parseBotCandidate('/application/detail/b%C3%B3t/template/master/dashboard/general?x=1#z').nome_bot, 'bót');
  assert.equal(routerIdentifier('https://macro.blip.ai/application/detail/router/template/master/'), 'router');
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a\n']) assert.throws(() => identifier(name));
  for (const href of ['https://evil.test/application/detail/bot/dashboard/general', 'https://a:b@macro.blip.ai/application/detail/bot/dashboard/general', '/application/detail/a%2Fb/dashboard/general', '/application/detail/bot/other']) assert.throws(() => parseBotCandidate(href));
  assert.throws(() => assertIdentity('https://macro.blip.ai/application/detail/other/templates/builder', 'bot'));
  assert.doesNotThrow(() => assertIdentity('https://macro.blip.ai/application/detail/bot/templates/builder/', 'bot'));
});
test('nomes Windows, colisões, truncamento e confinamento', () => {
  const names = ['CON','con','a:b','a?b','BOT','bot','x'.repeat(400), '../x'];
  assert.equal(new Set(names.map(safeName)).size, names.length);
  assert(names.map(safeName).every(x => x.length < 80 && !/[<>:"/\\|?*]/.test(x)));
  assert.throws(() => inside(path.join(tmpdir(), 'run'), '..', 'other'));
});
test('publicação, duplicatas, espaços e retomada detectam adulteração', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blip-test-'));
  const c = createJsonConfig();
  c.configuracoes_gerais.variaveis = { nome_bot: 'bot', identificador_fluxo: 'owner', variaveis_de_configuracao: [{key:'chave',value:' 0012 '},{key:'chave',value:''},{key:'unicode',value:'ação'}] };
  c.configuracoes_gerais.fluxo = { ok: true };
  const original = path.join(root, 'original.json'); await writeFile(original, '{"ok":true}');
  const files = { ...await publish(root, safeName('bot'), c), original: await record(root, original) };
  assert.equal(await verifyFiles(root, files, 'bot'), true);
  await assert.rejects(publish(root, safeName('bot'), c));
  await writeFile(inside(root, files.variaveis.path), '[]');
  assert.equal(await verifyFiles(root, files, 'bot'), false);
  assert.equal(createJsonConfig().configuracoes_gerais.fluxo, null);
  assert.throws(() => validateConfig(createJsonConfig()));
});
test('export preserva precisão, BOM e rejeita conteúdos indevidos', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'blip-export-')), f = path.join(root, 'raw.json');
  await writeFile(f, '\uFEFF{"n":900719925474099312345,"decimal":1.234567890123456789}');
  assert.equal(stringify(await readExport(f, 1000)), '{"n":900719925474099312345,"decimal":1.234567890123456789}');
  for (const bad of ['null', '42', '"text"', '<html>login</html>', '{', '']) {
    await writeFile(f, bad); await assert.rejects(readExport(f, 1000));
  }
  await writeFile(f, '{}'); await assert.rejects(readExport(f, 1));
});
test('repetição tem quatro tentativas, falhas permanentes não repetem', async () => {
  let count = 0;
  await assert.rejects(withRetry(async () => { count++; throw new Fault('TRANSITORIO', true); }, 3, 1, async () => {}));
  assert.equal(count, 4);
  count = 0;
  await assert.rejects(withRetry(async () => { count++; throw new Fault('PERMANENTE'); }, 3, 1, async () => {}));
  assert.equal(count, 1);
  count = 0;
  assert.equal(await withRetry(async () => { if (++count < 2) throw new Fault('TRANSITORIO', true); return 'ok'; }, 3, 1, async () => {}), 'ok');
});
