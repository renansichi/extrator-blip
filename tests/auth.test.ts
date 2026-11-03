import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { authenticate } from '../src/auth.js';
import { defaults } from '../src/config.js';
import { errorCode } from '../src/retry.js';

test('login confirma listagem mesmo com dois menus de usuário no portal', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const oldEmail = process.env.BLIP_EMAIL, oldPassword = process.env.BLIP_PASSWORD;
  process.env.BLIP_EMAIL = 'fixture@example.test'; process.env.BLIP_PASSWORD = 'fixture-only';
  try {
    const page = await browser.newPage();
    const destination = 'https://macro.blip.ai/application/detail/router/template/master/';
    await page.route('https://macro.blip.ai/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: route.request().url().includes('/login')
      ? `<input id="email"><input id="password" type="password"><button id="submit" onclick="sessionStorage.setItem('fixture-auth','yes');location.href='${destination}'">Entrar</button>`
      : `<script>if(!sessionStorage.getItem('fixture-auth'))location.replace('/login')</script><div class="services-list">Serviços</div><div id="buttonMenuUser">Menu</div><div id="buttonMenuUser">Menu duplicado</div>` }));
    const dir = await mkdtemp(path.join(tmpdir(), 'blip-auth-'));
    const settings = { ...defaults, manualLogin: false, storageState: path.join(dir, 'session.json'), selectors: { ...defaults.selectors, email: '#email', password: '#password', loginSubmit: '#submit', authenticated: '.services-list' } };
    let interventions = 0;
    await authenticate(page, destination, settings, async () => { interventions++; });
    assert.equal(interventions, 0);
    assert.equal(page.url(), destination);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('fixture-auth')), 'yes');
    assert.equal(await page.locator('#buttonMenuUser').count(), 2);
    await assert.rejects(page.locator('#buttonMenuUser').isVisible(), e => errorCode(e) === 'SELETOR_AMBIGUO');
    // A saved session may render only after DOMContentLoaded. It must not open login again.
    await page.unrouteAll();
    await page.route('https://macro.blip.ai/**', route => route.fulfill({ contentType: 'text/html', body: `<script>setTimeout(()=>{document.body.innerHTML='<div class="services-list">Ready</div>'},150)</script>` }));
    await authenticate(page, destination, settings, async () => { interventions++; });
    assert.equal(interventions, 0);
  } finally {
    if (oldEmail === undefined) delete process.env.BLIP_EMAIL; else process.env.BLIP_EMAIL = oldEmail;
    if (oldPassword === undefined) delete process.env.BLIP_PASSWORD; else process.env.BLIP_PASSWORD = oldPassword;
    await browser.close();
  }
});
