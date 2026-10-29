import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check, safePath, inside } from './files.mjs';

const exec = promisify(execFile);
export async function git(base, args) {
  await safePath(base);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  // Disable external diff, pagers, optional locks and fsmonitor hooks. No shell.
  const { stdout } = await exec('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: base, timeout: 10000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '0', GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat' }
  });
  return stdout;
}
export async function context(skill) {
  const root = await fs.realpath((await git(skill, ['rev-parse', '--show-toplevel'])).trim());
  await safePath(root);
  const actual = await fs.realpath(skill);
  check(inside(root, actual), 'PATH', 'Skill is outside Git repository');
  return { root, file: path.relative(root, path.join(actual, 'SKILL.md')).split(path.sep).join('/') };
}
export function revision(value) {
  check(typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value), 'REVISION', 'Use a full commit hash from history');
  return value;
}
export async function history(skill) {
  const { root, file } = await context(skill);
  const output = await git(root, ['log', '-30', '--format=%H%x09%aI%x09%s', '--', file]);
  return output.trim().split('\n').filter(Boolean).map(line => { const [hash, date, ...subject] = line.split('\t'); return { hash, date, subject: subject.join('\t') }; });
}
export async function changes(skill, from, to) {
  const { root, file } = await context(skill);
  const range = from ? [revision(from), ...(to ? [revision(to)] : [])] : [];
  return git(root, ['diff', '--no-ext-diff', '--no-textconv', ...range, '--', file]);
}
export async function historical(skill, hash) {
  const { root, file } = await context(skill);
  return git(root, ['show', '--no-textconv', `${revision(hash)}:${file}`]);
}
export async function tag(skill, name) {
  check(typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name) && !name.includes('..') && !name.endsWith('.lock'), 'TAG', 'Invalid version tag');
  const { root } = await context(skill);
  const hash = (await git(root, ['rev-parse', 'HEAD'])).trim();
  return { root, hash, name };
}
export async function cleanSkill(skill) {
  const { root, file } = await context(skill);
  return !(await git(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored', '--', path.posix.dirname(file)])).trim();
}
