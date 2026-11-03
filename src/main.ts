import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { loadSettings } from './config.js';
import { routerIdentifier, routerUrl, assertIdentity } from './router.js';
import { safeName, inside, atomicJson, publish, readExport, record, verifyFiles } from './storage.js';
import { createJsonConfig, Fault, type Manifest, type Bot } from './model.js';
import { errorCode, globalError, withRetry } from './retry.js';
import { authenticate } from './auth.js';
import { PortalAdapter } from './portal-adapter.js';
import { captureDownload } from './download.js';
const { values } = parseArgs({ options: { router: { type: 'string' }, config: { type: 'string' }, resume: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('npm start -- --router IDENTIFICADOR [--config blip.config.json] [--resume PASTA_EXECUCAO]');
} else {
  const rl = createInterface({ input: stdin, output: stdout });
  const abort = new AbortController();
  let closeBrowser: (() => Promise<void>) | undefined;
  const cancel = () => { abort.abort(); void closeBrowser?.(); };
  rl.on('SIGINT', cancel);
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  let manifest: Manifest | undefined, root: string | undefined;
  let release: (() => Promise<void>) | undefined;
  try {
    const settings = await loadSettings(values.config);
    const router = routerIdentifier(values.router ?? await rl.question('Qual é o identificador do router que deseja consultar? '));
    console.log(`Destino: ${routerUrl(router)}`);
    if (values.resume) {
      root = path.resolve(values.resume);
      manifest = JSON.parse(await fs.readFile(inside(root, 'manifesto.json'), 'utf8')) as Manifest;
      if (manifest.schema_version !== 1 || manifest.router !== router || !Array.isArray(manifest.bots)) throw new Fault('RETOMADA_INCOMPATIVEL', false, true);
    } else {
      const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      root = inside(settings.outputRoot, safeName(router), id);
      await fs.mkdir(root, { recursive: true });
      manifest = { schema_version: 1, run_id: id, router, iniciado_em: new Date().toISOString(), finalizado_em: null, fuso_apresentacao: 'America/Sao_Paulo', status: 'em_execucao', descoberta: { completa: false, evidencia_fim: null, total_informado_portal: null, total_unicos: 0 }, bots: [] };
    }
    const runRoot = root, m = manifest;
    const lock = await fs.open(inside(runRoot, '.execution.lock'), 'wx');
    release = async () => { await lock.close(); await fs.unlink(inside(runRoot, '.execution.lock')); };
    const save = () => atomicJson(inside(runRoot, 'manifesto.json'), m);
    m.status = 'em_execucao'; m.finalizado_em = null; delete m.erro; await save();
    const browser = await chromium.launch({ headless: settings.headless, ...(settings.browserChannel === 'chromium' ? {} : { channel: settings.browserChannel }) });
    closeBrowser = () => browser.close();
    try {
      const hasState = await fs.access(settings.storageState).then(() => true, () => false);
      const context = await browser.newContext({ acceptDownloads: true, ...(hasState ? { storageState: settings.storageState } : {}) });
      context.setDefaultTimeout(settings.actionTimeoutMs); context.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
      const page = await context.newPage();
      const intervention = async () => {
        m.status = 'aguardando_usuario'; await save();
        if (settings.headless) throw new Fault('LOGIN_MANUAL_EXIGE_NAVEGADOR_VISIVEL', false, true);
        try {
          await rl.question('Conclua o login/MFA no navegador, mantenha a janela aberta e pressione Enter aqui. ', { signal: abort.signal });
        } catch (e) { throw new Fault(errorCode(e), false, true); }
        m.status = 'em_execucao'; await save();
      };
      await authenticate(page, routerUrl(router), settings, intervention);
      const adapter = new PortalAdapter(settings);
      if (!m.descoberta.completa) {
        const discovery = await withRetry(() => adapter.discover(page), settings.maxRetries, settings.retryDelayMs, async e => { m.erro = errorCode(e); await save(); }, abort.signal);
        const { bots, ...coverage } = discovery;
        m.descoberta = coverage;
        for (const bot of bots) if (!m.bots.some(b => b.nome_bot === bot.nome_bot)) m.bots.push({ ...bot, safe: safeName(bot.nome_bot), status: 'pendente', etapa: 'abrir_builder', tentativas_por_etapa: {}, arquivos: {}, avisos: [], erro: null });
        await save();
      }
      for (const bot of m.bots) {
        abort.signal.throwIfAborted();
        // Never trust paths or URLs loaded from a resume manifest without rebuilding identity.
        const expected = (await import('./router.js')).parseBotCandidate(bot.source_url);
        if (expected.nome_bot !== bot.nome_bot || expected.builder_url !== bot.builder_url || bot.safe !== safeName(bot.nome_bot)) throw new Fault('RETOMADA_BOT_INVALIDO', false, true);
        if (bot.status === 'concluido' && await verifyFiles(runRoot, bot.arquivos, bot.nome_bot)) continue;
        const published = inside(runRoot, 'bots', bot.safe);
        if (await fs.access(published).then(() => true, () => false)) {
          // Preserve inconsistent/interrupted publication for review, then rebuild it.
          await fs.mkdir(inside(runRoot, 'temporarios'), { recursive: true });
          await fs.rename(published, inside(runRoot, 'temporarios', `recuperado-${randomUUID()}`));
        }
        bot.status = 'em_processamento'; bot.iniciado_em = new Date().toISOString(); bot.erro = null; await save();
        let renewed = false;
        try {
          await withRetry(async () => {
            const attempt = (bot.tentativas_por_etapa.coleta ?? 0) + 1;
            bot.tentativas_por_etapa.coleta = attempt;
            const p = await context.newPage();
            try {
              bot.etapa = 'abrir_builder'; await save();
              await p.goto(bot.builder_url, { waitUntil: 'domcontentloaded' });
              if (new URL(p.url()).pathname.includes('/login')) {
                if (renewed) throw new Fault('SESSAO_EXPIRADA_RECORRENTE', false, true);
                renewed = true; await authenticate(page, routerUrl(router), settings, intervention);
                await p.goto(bot.builder_url, { waitUntil: 'domcontentloaded' });
              }
              assertIdentity(p.url(), bot.nome_bot);
              const jsonConfig = createJsonConfig();
              bot.etapa = 'configuracao'; await save();
              const snapshot = await adapter.snapshot(p, bot.nome_bot);
              jsonConfig.configuracoes_gerais.variaveis = { nome_bot: bot.nome_bot, identificador_fluxo: snapshot.id, variaveis_de_configuracao: snapshot.variables };
              if (new Set(snapshot.variables.map(v => v.key)).size < snapshot.variables.length && !bot.avisos.includes('CHAVES_REPETIDAS_PRESERVADAS')) bot.avisos.push('CHAVES_REPETIDAS_PRESERVADAS');
              bot.etapa = 'download'; await save();
              const raw = inside(runRoot, 'originais', bot.safe, `tentativa-${attempt}`, 'export-original.json');
              const action = await adapter.exportAction(p, bot.nome_bot);
              await captureDownload(p, action, bot.nome_bot, raw, settings.downloadTimeoutMs);
              bot.arquivos = { original: await record(runRoot, raw) }; await save();
              jsonConfig.configuracoes_gerais.fluxo = await readExport(raw, settings.maxDownloadBytes);
              bot.etapa = 'publicacao'; await save();
              bot.arquivos = { ...bot.arquivos, ...await publish(runRoot, bot.safe, jsonConfig) };
              if (!await verifyFiles(runRoot, bot.arquivos, bot.nome_bot)) throw new Fault('VERIFICACAO_FINAL_FALHOU', false, true);
              bot.status = 'concluido'; bot.etapa = 'concluido'; bot.finalizado_em = new Date().toISOString(); await save();
            } finally { if (!p.isClosed()) await p.close(); }
          }, settings.maxRetries, settings.retryDelayMs, async e => { bot.erro = errorCode(e); await save(); }, abort.signal);
          bot.erro = null;
        } catch (e) {
          bot.status = 'falhou'; bot.erro = errorCode(e); await save();
          if (globalError(e) || abort.signal.aborted) throw e;
        }
        console.log(`${bot.nome_bot}: ${bot.status}`);
      }
      m.status = m.descoberta.completa && m.bots.every(b => b.status === 'concluido') ? 'concluida' : 'parcial';
      delete m.erro;
    } finally { await browser.close(); }
    m.finalizado_em = new Date().toISOString(); await save();
    console.log(JSON.stringify({ status: m.status, descobertos: m.bots.length, concluidos: m.bots.filter(b => b.status === 'concluido').length, falhas: m.bots.filter(b => b.status === 'falhou').length, descoberta_completa: m.descoberta.completa, pasta: runRoot }, null, 2));
    if (m.status !== 'concluida') process.exitCode = 2;
  } catch (e) {
    const code = errorCode(e);
    if (process.env.BLIP_DEBUG === '1' && e instanceof Error) console.error(e.stack?.split('\n').filter(line => /^\s+at /.test(line)).slice(0, 4).join('\n'));
    if (manifest && root && release) { manifest.status = abort.signal.aborted ? 'cancelada' : 'falhou'; manifest.erro = code; manifest.finalizado_em = new Date().toISOString(); await atomicJson(inside(root, 'manifesto.json'), manifest).catch(() => {}); }
    console.error(`Execução interrompida: ${abort.signal.aborted ? 'CANCELADA' : code}`); process.exitCode = 1;
    if (root) console.error(`Relatório da execução: ${inside(root, 'manifesto.json')}`);
  } finally { await release?.(); rl.close(); process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
