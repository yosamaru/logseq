import test from 'node:test';
import assert from 'node:assert/strict';
import { keys, translator } from '../src/ui/i18n.mjs';
import { filterSkills, lineDiff } from '../src/ui/model.mjs';
import { readTranslations } from './helpers.mjs';
import fs from 'node:fs/promises';

test('native view uses complete English/Chinese core dictionaries and translated keys', async () => {
  const en = await readTranslations('en'), zh = await readTranslations('zh-CN');
  for (const key of keys) { assert.equal(typeof en[key], 'string', key); assert.equal(typeof zh[key], 'string', key); }
  const app = await fs.readFile(new URL('../src/ui/app.mjs', import.meta.url), 'utf8');
  for (const match of app.matchAll(/\b(?:t|button|input)\('([^']+)'/g)) assert.ok(keys.includes(match[1]), match[1]);
  assert.equal(translator(zh)('save'), '预览保存');
  assert.equal(app.includes('fetch('), false);
  assert.equal(app.includes('registerUIItem'), false);
});
test('search and filters work across hundreds of Skills', () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ name: `skill-${i}`, description: 'Review code', tags: ['review'], source: 'local', path: '/skills', modified: '2026-10-29', domain: 'code', version: '1', agents: ['pi'], issues: [], installations: [{ agent: 'pi', state: 'installed' }] }));
  const filters = { query: 'skill-499', agent: 'pi', domain: 'code', version: '1', status: 'installed', sort: 'name' };
  assert.equal(filterSkills(items, filters).length, 1);
  assert.equal(filterSkills(items, { ...filters, query: 'review' }).length, 500);
  assert.equal(filterSkills(items, { ...filters, query: '2026-10-29' }).length, 500);
  assert.match(lineDiff('a\nb\nc', 'a\nd\nc'), /-b\n\+d/);
});
