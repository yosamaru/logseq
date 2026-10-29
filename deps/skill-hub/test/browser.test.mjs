import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { setup, readTranslations } from './helpers.mjs';

test('built-in view: automatic startup, native bridge, edit, sanitize, install, link and draft', { timeout: 60000 }, async t => {
  const { base, dir, root, targets } = await setup(t);
  const { DesktopHub } = createRequire(import.meta.url)('../dist/runtime/skill-hub.cjs');
  const userData = path.join(base, 'desktop-data'); await fs.mkdir(userData);
  const desktop = new DesktopHub(userData); await desktop.init();
  await desktop.authorizeDirectory('root', root, { writable: true });
  await desktop.authorizeDirectory('target', targets[0].path, { agent: 'pi' });
  let links = 0, reveals = 0;
  let signalRevealed;
  const revealDone = new Promise(resolve => { signalRevealed = resolve; });
  const strings = await readTranslations('en');
  const browser = await chromium.launch({ channel: process.env.SKILL_HUB_BROWSER_CHANNEL || 'msedge', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1360, height: 960 } });
  await page.exposeFunction('testHostRequest', async (operation, args) => {
    switch (operation) {
      case 'startup': return { translations: strings, note: { content: '# Selected note' } };
      case 'rpc': return desktop.request(args.operation, args.args);
      case 'editor':
        if (args.method === 'getPage') return null;
        if (args.method === 'createPage') return { uuid: 'page-uuid' };
        if (args.method === 'insertBlock') { links++; return { uuid: 'link-uuid' }; }
        throw new Error('Unsupported editor method');
      case 'reveal': reveals++; signalRevealed(); return { result: true };
      case 'close': return null;
      default: throw new Error('Unknown host operation');
    }
  });
  const hostPage = `<!doctype html><html><body><script>addEventListener('message',async event=>{if(event.source!==document.querySelector('iframe').contentWindow||event.origin!==location.origin||event.data?.channel!=='logseq-skill-hub')return;try{const result=await testHostRequest(event.data.operation,event.data.args);event.source.postMessage({channel:'logseq-skill-hub',id:event.data.id,result},event.origin)}catch(error){event.source.postMessage({channel:'logseq-skill-hub',id:event.data.id,error:{message:error.message}},event.origin)}})</script><iframe title="Skill Hub" src="/view/index.html" style="border:0;width:100%;height:95vh"></iframe></body></html>`;
  const ui = http.createServer(async (req, res) => {
    try {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(hostPage); return; }
      const name = req.url.slice('/view/'.length);
      if (!req.url.startsWith('/view/') || !/^[a-zA-Z0-9./-]+$/.test(name) || name.includes('..')) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'application/javascript');
      res.end(await fs.readFile(new URL(`../dist/${name}`, import.meta.url)));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => ui.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { ui.close(resolve); ui.closeAllConnections(); }));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${ui.address().port}`);
  const view = page.frameLocator('iframe');
  await view.getByRole('button', { name: /sample.*Review source/ }).waitFor();
  assert.equal(await view.getByRole('button', { name: 'Close', exact: true }).count(), 0);
  assert.equal(await view.getByRole('heading', { name: 'Skill Hub', exact: true }).count(), 0);
  const themeStyle = await page.addStyleTag({ content: `
    :root { --background: 190 100% 11%; --foreground: 44 87% 94%;
      --secondary: 192 81% 14%; --border: 192 26% 32%; --primary: 175 59% 40%;
      --muted-foreground: 186 13% 63%; --destructive: 1 71% 52%; --radius: 8px; }
    html[data-theme=light] { --background: 0 0% 100%; --foreground: 222 47% 11%; }
    body { font-family: 'Courier New', monospace; font-size: 15px; }
  ` });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  const frame = await page.locator('iframe').elementHandle();
  await page.waitForFunction(frame => getComputedStyle(frame.contentDocument.body).backgroundColor === 'rgb(0, 47, 56)', frame);
  assert.equal(await view.locator('body').evaluate(node => getComputedStyle(node).fontFamily), '"Courier New", monospace');
  assert.equal(await view.locator('#app').evaluate(node => getComputedStyle(node).margin), '0px');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.waitForFunction(frame => getComputedStyle(frame.contentDocument.body).backgroundColor === 'rgb(255, 255, 255)', frame);
  await themeStyle.evaluate(node => { node.textContent += ':root { --ls-primary-background-color: #fdf6e3; --ls-primary-text-color: #586e75; }'; });
  await page.waitForFunction(frame => getComputedStyle(frame.contentDocument.body).backgroundColor === 'rgb(253, 246, 227)', frame);
  assert.equal(await view.locator('body').evaluate(node => getComputedStyle(node).color), 'rgb(88, 110, 117)');
  assert.equal(await view.getByLabel('Session token').count(), 0);
  await view.getByLabel('Search name, description, tags, source or date').fill('no-match');
  assert.match(await view.locator('#skills').textContent(), /No Skills match/);
  await view.getByLabel('Search name, description, tags, source or date').fill('sample');
  await view.getByRole('button', { name: /sample.*Review source/ }).click();
  await view.getByRole('link', { name: dir }).click(); await revealDone; assert.equal(reveals, 1);
  const editor = view.getByRole('textbox', { name: 'SKILL.md source', exact: true });
  await editor.fill(await editor.inputValue() + '\n# Browser edit\n<img src="https://invalid.example/tracker" onerror="alert(1)"><svg><image xlink:href="https://invalid.example/svg-tracker"></image></svg>');
  await view.getByRole('button', { name: 'Markdown preview', exact: true }).click();
  assert.equal(await view.locator('dialog .markdown img').count(), 0);
  assert.equal(await view.locator('dialog .markdown svg').count(), 0);
  await view.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await view.getByRole('button', { name: 'Preview save', exact: true }).click();
  assert.match(await view.getByRole('dialog').textContent(), /Browser edit/);
  await view.getByRole('button', { name: 'Confirm this exact plan', exact: true }).click();
  await view.getByText('Operation completed', { exact: true }).waitFor();
  assert.match(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'), /Browser edit/);
  await view.getByRole('button', { name: 'Preview install / update', exact: true }).click();
  await view.getByRole('button', { name: 'Confirm this exact plan', exact: true }).click();
  await view.getByText('Operation completed', { exact: true }).waitFor();
  assert.match(await fs.readFile(path.join(targets[0].path, 'sample', 'SKILL.md'), 'utf8'), /Browser edit/);
  await view.getByRole('button', { name: 'Link to a Logseq page', exact: true }).click();
  await view.getByText('Knowledge link created. Skill files remain the source of truth.', { exact: true }).waitFor();
  assert.equal(links, 1);
  await view.getByRole('button', { name: 'Draft from selected note', exact: true }).click();
  await view.getByRole('button', { name: 'Use selected note', exact: true }).click();
  assert.equal(await view.getByRole('textbox', { name: 'Note content', exact: true }).inputValue(), '# Selected note');
  await view.getByRole('textbox', { name: 'New Skill name', exact: true }).fill('note-skill');
  await view.getByRole('button', { name: 'Preview draft', exact: true }).click();
  await view.getByRole('button', { name: 'Confirm this exact plan', exact: true }).click();
  await view.getByText('Operation completed', { exact: true }).waitFor();
  assert.match(await fs.readFile(path.join(userData, 'agent-skills', 'note-skill', 'SKILL.md'), 'utf8'), /Selected note/);
  await view.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: path.resolve('dist/browser-preview.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
