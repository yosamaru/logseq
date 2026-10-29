import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class HubError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
export function check(condition, code, message, details) {
  if (!condition) throw new HubError(code, message, details);
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export const inside = (base, target) => {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
export async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
// Reject all symlinks/junctions, including ancestors, rather than attempting to
// infer ownership of their targets. Every mutating operation revalidates paths.
export async function safePath(base, relative = '', { missing = false } = {}) {
  check(path.isAbsolute(base), 'PATH', 'Root must be absolute');
  check(typeof relative === 'string' && !path.isAbsolute(relative) && !relative.includes('\0'), 'PATH', 'Invalid relative path');
  const target = path.resolve(base, relative);
  check(inside(path.resolve(base), target), 'PATH', 'Path escapes authorized root');
  const parsed = path.parse(target);
  let cursor = parsed.root;
  const segments = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let i = 0; i < segments.length; i++) {
    cursor = path.join(cursor, segments[i]);
    let stat;
    try { stat = await fs.lstat(cursor); }
    catch (error) {
      if (missing && error.code === 'ENOENT') return target;
      throw error;
    }
    check(!stat.isSymbolicLink(), 'LINK', 'Symlinks and junctions are not managed');
    check(i === segments.length - 1 || stat.isDirectory(), 'PATH', 'Ancestor is not a directory');
  }
  return target;
}
export async function tree(base, { limit = 10000, maxBytes = 32 * 1024 * 1024 } = {}) {
  await safePath(base);
  const files = [];
  let total = 0;
  async function walk(relative) {
    const dir = await safePath(base, relative);
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const name = path.join(relative, entry.name);
      const file = await safePath(base, name);
      const stat = await fs.lstat(file);
      check(files.length < limit, 'LIMIT', 'Too many Skill files');
      if (stat.isDirectory()) { await walk(name); continue; }
      check(stat.isFile() && stat.nlink === 1, 'FILE', 'Special files and hard links are not managed');
      total += stat.size;
      check(total <= maxBytes, 'LIMIT', 'Skill exceeds size limit');
      files.push({ path: name.split(path.sep).join('/'), hash: digest(await fs.readFile(file)), size: stat.size });
    }
  }
  await walk('');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export const treeHash = files => digest(JSON.stringify(files));
export async function readText(base, relative) {
  const file = await safePath(base, relative);
  const stat = await fs.lstat(file);
  check(stat.isFile() && stat.nlink === 1 && stat.size <= 2 * 1024 * 1024, 'FILE', 'Not a regular text file or file too large');
  return fs.readFile(file, 'utf8');
}
export async function atomicWrite(base, relative, value) {
  const target = await safePath(base, relative, { missing: true });
  const temp = `${target}.${randomUUID()}.pending`;
  try {
    await fs.writeFile(temp, value, { flag: 'wx', mode: 0o600 });
    await safePath(base, relative, { missing: true });
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}
export async function copyTree(source, destination) {
  const files = await tree(source);
  await safePath(destination, '', { missing: true });
  check(!await exists(destination), 'CONFLICT', 'Staging directory already exists');
  await fs.mkdir(destination);
  for (const file of files) {
    const src = await safePath(source, file.path);
    const dst = await safePath(destination, file.path, { missing: true });
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst, 1);
    await fs.chmod(dst, (await fs.stat(src)).mode & 0o777);
  }
  check(treeHash(await tree(destination)) === treeHash(files), 'CHANGED', 'Source changed during copy');
  return files;
}
