import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { DesktopHub } from '../src/desktop.mjs';
import { safePath, exists } from '../src/files.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const base = path.join(repo, 'tmp/skill-hub-acceptance');
const project = path.join(base, 'pi-project');
const skillName = 'verify-skill-inventory';
const source = path.join(repo, 'agent-skills');
const target = path.join(project, '.pi/skills');
const userData = path.join(base, 'Logseq-user-data');
const input = path.join(project, 'acceptance-input.json');
const piEntry = process.argv[2];
if (!piEntry || !path.isAbsolute(piEntry)) throw new Error('Pass the absolute installed Pi cli.js path');
await fs.mkdir(target, { recursive: true }); await fs.mkdir(userData, { recursive: true });
if (!await exists(input)) await fs.writeFile(input, JSON.stringify({ items: [
  { id: 'java-code-review', installed: true },
  { id: 'oracle-sql-optimization', installed: false },
  { id: 'spring-transaction-debugging', installed: true }
] }, null, 2), { flag: 'wx' });
const desktop = new DesktopHub(userData);
let config = (await desktop.request('config')).result;
if (!config.roots.some(item => path.resolve(item.path) === source)) await desktop.authorizeDirectory('root', source);
if (!config.targets.some(item => path.resolve(item.path) === target)) await desktop.authorizeDirectory('target', target, { agent: 'pi' });
config = (await desktop.request('config')).result;
const scan = (await desktop.request('scan')).result;
const item = scan.skills.find(item => item.name === skillName);
assert.ok(item && !item.issues.some(issue => issue.severity === 'error'), 'Generated Skill passes Hub validation');
const installationTarget = config.targets.find(item => path.resolve(item.path) === target);
const preview = await desktop.request('preview', { kind: 'install', id: item.id, target: installationTarget.id });
assert.ok(preview.result, JSON.stringify(preview.error));
// The user requested an installation/test in this isolated project. Persist the
// exact plan as evidence and apply it only to the explicit test destination.
const report = { time: new Date().toISOString(), source: item.path, target: preview.result.destination, plan: preview.result.changes, installed: false, recognized: false, loaded: false, executed: false, toolEvidence: [], model: null };
const applied = await desktop.request('confirm', { plan: preview.result.id, confirmed: true });
assert.equal(applied.result?.applied, true, JSON.stringify(applied.error)); report.installed = true;
assert.ok(await exists(await safePath(target, `${skillName}/SKILL.md`)));
const destination = path.join(target, skillName);
const child = spawn(process.execPath, [piEntry, '--mode', 'rpc', '--no-session', '--no-extensions', '--no-mcp', '--no-context-files', '--no-prompt-templates', '--no-themes', '--approve', '--offline', '--tools', 'read,powershell'], {
  cwd: project, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PI_TELEMETRY: 'false' }
});
const pending = new Map();
let buffer = '', stderrSeen = false, finalText = '';
let resolveSettled, rejectSettled;
const settled = new Promise((resolve, reject) => { resolveSettled = resolve; rejectSettled = reject; });
// Mark rejection observed until the prompt reaches its wait point.
settled.catch(() => {});
function send(type, args = {}) {
  const id = `check-${pending.size}-${Date.now()}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Pi RPC ${type} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, type, ...args }) + '\n');
  });
}
function record(event) {
  if (event.type === 'response' && pending.has(event.id)) {
    const entry = pending.get(event.id); pending.delete(event.id); clearTimeout(entry.timer);
    if (event.success) entry.resolve(event.data);
    else entry.reject(new Error(`Pi rejected ${event.command}`));
  }
  if (event.type === 'message_end') {
    const message = event.message;
    const text = typeof message?.content === 'string' ? message.content : (message?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (message?.role === 'user' && text.includes('Verify a local Skill inventory')) report.loaded = true;
    if (message?.role === 'assistant') {
      finalText = text;
      if (message.stopReason === 'error') report.providerError = 'Pi provider returned an error; authentication or model availability needs checking';
    }
  }
  if (event.type === 'tool_execution_start') {
    const args = event.args || event.input || {};
    const action = args.path || args.command || '';
    if (typeof action === 'string' && (action.includes('verify-inventory.mjs') || action.includes('procedure.md'))) report.toolEvidence.push({ phase: 'start', tool: event.toolName, action });
  }
  if (event.type === 'tool_execution_end') {
    const text = (event.result?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (!event.isError && text.includes('c37dbcf2bd3aacf8bffdecf8945f6505a45e98c4bdf7e8569a6e676d8f45ee73')) {
      report.executed = true;
      report.toolEvidence.push({ phase: 'end', tool: event.toolName, matchedExpectedDigest: true });
    }
  }
  if (event.type === 'agent_settled') resolveSettled(event);
}
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n'), line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;
    try { record(JSON.parse(line)); } catch { rejectSettled(new Error('Invalid Pi JSONL record')); }
  }
});
child.stderr.on('data', () => { stderrSeen = true; });
child.on('error', error => rejectSettled(new Error(`Pi startup failed: ${error.code}`)));
child.on('close', () => {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Pi exited before response')); }
  pending.clear(); rejectSettled(new Error('Pi exited before completion'));
});
let deadline;
try {
  const commands = await send('get_commands');
  const command = commands.commands.find(command => command.source === 'skill' && command.name === `skill:${skillName}`);
  assert.ok(command, 'Pi natively discovered the installed Skill command');
  assert.equal(path.resolve(command.sourceInfo.path), path.join(destination, 'SKILL.md'));
  report.recognized = true; report.command = command.name; report.discoveredPath = command.sourceInfo.path;
  const state = await send('get_state'); report.model = { provider: state.model?.provider, id: state.model?.id };
  console.info(`Installed and recognized: ${command.name}; invoking Pi using its configured model.`);
  await send('prompt', { message: `/skill:${skillName} Verify the local inventory at ${input}. Run the bundled verification script and return its JSON report and the procedure marker. Do not modify files.` });
  await Promise.race([settled, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Pi test exceeded 180 seconds')), 180000); })]);
  report.markerReturned = finalText.includes('SKILL_HUB_PI_VERIFIED_20261029');
  report.finalDigestReturned = finalText.includes('c37dbcf2bd3aacf8bffdecf8945f6505a45e98c4bdf7e8569a6e676d8f45ee73');
  // Save only the requested harmless result, never arbitrary diagnostics or
  // credentials. The final response is retained only after matching our digest.
  if (report.finalDigestReturned) report.finalResponse = finalText;
  assert.ok(report.loaded, 'Pi expanded the Skill body into the actual prompt');
  assert.ok(report.executed, 'Pi tool execution returned the independently computed digest');
  assert.ok(report.markerReturned && report.finalDigestReturned, 'Pi returned reference marker and exact verification result');
  report.passed = true;
} catch (error) { report.passed = false; report.failure = error.message; }
finally {
  clearTimeout(deadline); report.stderrObserved = stderrSeen;
  child.stdin.end();
  const exit = new Promise(resolve => child.once('close', resolve));
  const forceClose = setTimeout(() => child.kill(), 3000);
  await exit; clearTimeout(forceClose);
  await fs.writeFile(path.join(repo, 'deps/skill-hub/PI-ACCEPTANCE.json'), JSON.stringify(report, null, 2));
}
console.info(JSON.stringify({ installed: report.installed, recognized: report.recognized, loaded: report.loaded, executed: report.executed, passed: report.passed, failure: report.failure }, null, 2));
if (!report.passed) process.exitCode = 1;
