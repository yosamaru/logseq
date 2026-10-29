import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { check } from './files.mjs';

const exec = promisify(execFile);
export const adapters = Object.freeze({
  pi: { command: 'pi', user: '.pi/agent/skills', project: '.pi/skills' },
  codex: { command: 'codex', user: '.agents/skills', project: '.agents/skills' },
  claude: { command: 'claude', user: '.claude/skills', project: '.claude/skills' }
});
export function targetPath(agent, scope, project, home = os.homedir()) {
  const adapter = adapters[agent];
  check(adapter && ['user', 'project'].includes(scope), 'ADAPTER', 'Unknown agent or scope');
  check(scope === 'user' || (typeof project === 'string' && path.isAbsolute(project)), 'PATH', 'Project directory must be absolute');
  return path.resolve(scope === 'user' ? home : project, adapter[scope]);
}
export function compatible(agent, name) {
  check(Object.hasOwn(adapters, agent), 'ADAPTER', 'Unknown agent');
  check(agent !== 'claude' || !['synced', 'anthropic-skills'].includes(name), 'COMPATIBILITY', 'Name is reserved by Claude Code');
}
export async function detect(agent, executable) {
  check(Object.hasOwn(adapters, agent), 'ADAPTER', 'Unknown agent');
  // Never invoke a shell, search user-provided command text or run Skill scripts.
  if (!executable) return { agent, available: null, version: null, reason: 'No executable explicitly configured', recognized: null, loaded: null, executed: null };
  check(path.isAbsolute(executable), 'PATH', 'Executable must be an absolute path');
  try {
    const { stdout } = await exec(executable, ['--version'], { timeout: 5000, maxBuffer: 8192, windowsHide: true });
    return { agent, available: true, version: stdout.trim().slice(0, 200), recognized: null, loaded: null, executed: null };
  } catch (error) {
    return { agent, available: false, version: null, reason: error.code === 'ENOENT' ? 'Executable not found' : 'Version detection failed', recognized: null, loaded: null, executed: null };
  }
}
