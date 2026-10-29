import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node verify-inventory.mjs <inventory-json-path>');
  const file = process.argv[2];
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Input must be a regular JSON file smaller than 1 MiB');
  const input = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!input || !Array.isArray(input.items)) throw new Error('Input must contain an items array');
  const ids = new Set();
  for (const item of input.items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.installed !== 'boolean') throw new Error('Each item needs a nonempty id and an installed boolean');
    if (ids.has(item.id)) throw new Error('Duplicate inventory id');
    ids.add(item.id);
  }
  const normalized = input.items.map(({ id, installed }) => ({ id, installed })).sort((a, b) => a.id.localeCompare(b.id));
  const installed = normalized.filter(item => item.installed).length;
  console.log(JSON.stringify({ total: normalized.length, installed, notInstalled: normalized.length - installed, ids: normalized.map(item => item.id), sha256: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
