import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DesktopHub } from '../src/desktop.mjs';
import { fixture, skill, content } from './helpers.mjs';

test('native runtime initializes owned directories and persists read-only imports', async t => {
  const base = await fixture(t);
  const userData = path.join(base, 'app-data'); await fs.mkdir(userData);
  const service = new DesktopHub(userData);
  let response = await service.request('config');
  assert.equal(response.result.roots[0].writable, true);
  assert.deepEqual(response.result.targets, []);
  const imported = path.join(base, 'existing'); await fs.mkdir(imported); await skill(imported);
  await service.authorizeDirectory('root', imported);
  response = await service.request('scan');
  assert.equal(response.result.skills[0].writable, false);
  const item = response.result.skills[0];
  response = await service.request('preview', { kind: 'save', id: item.id, expected: item.contentHash, text: content() });
  assert.equal(response.error.code, 'READ_ONLY');
  const reopened = new DesktopHub(userData);
  assert.equal((await reopened.request('scan')).result.skills.length, 1);
});
test('native requests serialize preview-confirm; errors resolve without sensitive IPC logging', async t => {
  const base = await fixture(t);
  const service = new DesktopHub(base); const hub = await service.init();
  await skill(hub.config.roots[0].path);
  const item = (await service.request('scan')).result.skills[0];
  const invalid = await service.request('preview', { kind: 'save', id: item.id, expected: item.contentHash, text: '# Secret draft without YAML' });
  assert.equal(invalid.error.code, 'VALIDATION');
  assert.ok(invalid.error.details.some(issue => issue.code === 'FRONTMATTER'));
  assert.equal(JSON.stringify(invalid).includes('Secret draft'), false);
  const plan = (await service.request('preview', { kind: 'save', id: item.id, expected: item.contentHash, text: content('sample', '# Native edit') })).result;
  const results = await Promise.all([service.request('confirm', { plan: plan.id, confirmed: true }), service.request('confirm', { plan: plan.id, confirmed: true })]);
  assert.equal(results.filter(x => x.result?.applied).length, 1);
  assert.equal(results.filter(x => x.error?.code === 'PLAN').length, 1);
  await assert.rejects(service.authorizeDirectory('root', hub.config.roots[0].path), { code: 'CONFIG' });
});
test('packaged CJS runtime loads with require and operates without external YAML dependency', async t => {
  const { DesktopHub: BundledHub } = createRequire(import.meta.url)('../dist/runtime/skill-hub.cjs');
  const base = await fixture(t), service = new BundledHub(base);
  const response = await service.request('config');
  assert.equal(response.result.roots.length, 1);
  const bundle = await fs.readFile(new URL('../dist/runtime/skill-hub.cjs', import.meta.url), 'utf8');
  assert.equal(/require\(["']yaml["']\)/.test(bundle), false);
});
