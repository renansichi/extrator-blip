import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults } from '../src/config.js';
import { PortalAdapter } from '../src/portal-adapter.js';
import { captureDownload } from '../src/download.js';
test('DOM: descoberta paginada, snapshot atual, download rápido e identidade', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const p = await browser.newPage({ acceptDownloads: true });
    await p.route('https://macro.blip.ai/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<main><div class="services-list"><a href="/application/detail/bot/dashboard/general">bot</a></div><button id="next" onclick="document.querySelector('a').href='/application/detail/bot2/dashboard/general';this.disabled=true">Próxima</button><input value="Configurações gerais"><form id="variablesForm"><key-value-item key="old" value="old"><input name="key" value="repetida"><input name="value" value=" 0012 "></key-value-item><key-value-item key="old" value="old"><input name="key" value="repetida"><input name="value" value=""></key-value-item></form><div id="owner-identity"><div><div><input value="owner"></div></div></div><button id="download" onclick="const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['{&quot;flow&quot;:true}'],{type:'application/json'}));a.download='flow.json';a.click()">Baixar</button></main>` }));
    await p.goto('https://macro.blip.ai/application/detail/bot/templates/builder');
    await p.locator('#download').evaluate(el => { el.outerHTML = '<button id="versions" onclick="setTimeout(()=>document.getElementById(\'export-panel\').hidden=false,100)">Versões</button><div id="export-panel" hidden><a id="download" href="data:application/json;base64,eyJmbG93Ijp0cnVlfQ==" download="flow.json">Baixar</a></div>'; });
    const settings = { ...defaults, actionTimeoutMs: 1000, variablesVerified: true, variablesComplete: true, selectors: { ...defaults.selectors, listingReady: '.services-list', nextPage: '#next', formReady: '#variablesForm', variables: 'key-value-item', variableKeyInput: 'input[name=key]', variableValueInput: 'input[name=value]' } };
    const a = new PortalAdapter(settings);
    const discovery = await a.discover(p);
    assert.equal(discovery.bots.length, 2); assert.equal(discovery.completa, true);
    const snapshot = await a.snapshot(p, 'bot');
    assert.deepEqual(snapshot.variables, [{key:'repetida',value:' 0012 '},{key:'repetida',value:''}]);
    const root = await mkdtemp(path.join(tmpdir(), 'blip-download-'));
    const file = path.join(root, 'original.json');
    settings.selectors.exportAction = '#download'; settings.selectors.exportSteps = ['#versions'];
    await captureDownload(p, await a.exportAction(p, 'bot'), 'bot', file, 2000);
    assert.equal(await readFile(file, 'utf8'), '{"flow":true}');
    await assert.rejects(captureDownload(p, p.locator('#download'), 'other', path.join(root, 'wrong.json'), 100));
    settings.selectors.nextPage = '';
    assert.equal((await a.discover(p)).completa, false);
    settings.selectors.variables = '.missing';
    await assert.rejects(a.snapshot(p, 'bot'));
  } finally { await browser.close(); }
});
