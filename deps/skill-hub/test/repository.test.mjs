import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath, tree, atomicWrite } from '../src/files.mjs';
import { metadata, validate, security } from '../src/validate.mjs';

import { fixture, content, skill } from './helpers.mjs';
test('YAML, required metadata and portable extensions', () => {
  assert.equal(metadata(content(), 'sample').issues.length, 0);
  for (const text of ['# no frontmatter', '---\nname: [\n---\n', '---\nname: sample\nname: other\n---\n']) assert.ok(metadata(text, 'sample').issues.length);
  assert.ok(metadata(content('bad--name'), 'bad--name').issues.some(x => x.code === 'NAME'));
  assert.deepEqual(metadata(content(), 'sample').tags, ['code', 'review']);
});
test('path traversal, read safety, references and static risks', async t => {
  const base = await fixture(t);
  const dir = await skill(base, 'sample', '[missing](references/gone.md)\n[escape](../secret)\n`rm -rf /`');
  await assert.rejects(safePath(dir, '../outside'), { code: 'PATH' });
  assert.equal((await validate(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'), 'sample', dir)).references.filter(x => !x.exists).length, 2);
  assert.ok((await security(dir, await tree(dir))).some(x => x.code === 'DESTRUCTIVE'));
  await atomicWrite(dir, 'SKILL.md', content());
  assert.equal(await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8'), content());
});
test('junction escape is rejected', async t => {
  const base = await fixture(t);
  await fs.mkdir(path.join(base, 'outside'));
  await fs.symlink(path.join(base, 'outside'), path.join(base, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safePath(path.join(base, 'linked')), { code: 'LINK' });
});
