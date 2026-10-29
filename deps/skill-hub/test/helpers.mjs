import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Hub } from '../src/hub.mjs';

export const content = (name = 'sample', body = '# Instructions\n', version = '1.0') => `---\nname: ${name}\ndescription: Review source when requested.\nmetadata:\n  version: "${version}"\n  tags: "code, review"\n---\n${body}`;
export async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-hub-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return base;
}
export async function skill(base, name = 'sample', body) {
  const dir = path.join(base, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), content(name, body));
  return dir;
}
export async function setup(t, writable = true) {
  const base = await fixture(t);
  const root = path.join(base, 'source');
  await fs.mkdir(root);
  const dir = await skill(root);
  const targets = ['pi', 'codex', 'claude'].map(agent => ({ id: agent, agent, path: path.join(base, `${agent}-target`) }));
  for (const target of targets) await fs.mkdir(target.path);
  const config = { roots: [{ id: 'source', path: root, writable }], targets, state: path.join(base, 'state') };
  const hub = await new Hub(config).init();
  const { skills } = await hub.scan();
  return { base, root, dir, config, hub, item: skills[0], targets };
}
export async function readTranslations(locale) {
  const source = await fs.readFile(new URL(`../../../src/resources/dicts/${locale}.edn`, import.meta.url), 'utf8');
  const kebab = key => key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`);
  const { keys } = await import('../src/ui/i18n.mjs');
  const entries = new Map([...source.matchAll(/:skill-hub\/([a-z0-9-]+)\s+("(?:\\.|[^"\\])*")/g)].map(match => [match[1], JSON.parse(match[2])]));
  return Object.fromEntries(keys.map(key => [key, entries.get(kebab(key))]));
}
