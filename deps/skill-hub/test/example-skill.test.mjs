import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../../../agent-skills/verify-skill-inventory/scripts/verify-inventory.mjs', import.meta.url));
test('generated Skill script reports actual inventory counts without modifying input', async t => {
  const base = await fixture(t), file = path.join(base, 'input.json');
  const input = JSON.stringify({ items: [{ id: 'a', installed: true }, { id: 'b', installed: false }, { id: 'c', installed: true }] });
  await fs.writeFile(file, input);
  const { stdout } = await exec(process.execPath, [script, file], { windowsHide: true });
  const result = JSON.parse(stdout);
  assert.equal(result.total, 3); assert.equal(result.installed, 2); assert.equal(result.notInstalled, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await fs.readFile(file, 'utf8'), input);
});
test('generated Skill script rejects duplicate IDs and invalid booleans', async t => {
  const base = await fixture(t), file = path.join(base, 'input.json');
  for (const items of [[{ id: 'a', installed: true }, { id: 'a', installed: false }], [{ id: 'a', installed: 'true' }]]) {
    await fs.writeFile(file, JSON.stringify({ items }));
    await assert.rejects(exec(process.execPath, [script, file], { windowsHide: true }), error => error.code === 1);
  }
});
