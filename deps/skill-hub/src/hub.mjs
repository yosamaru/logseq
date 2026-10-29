import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { HubError, check, digest, inside, exists, safePath, tree, treeHash, readText, atomicWrite, copyTree } from './files.mjs';
import { validate, security } from './validate.mjs';
import { adapters, compatible, detect } from './adapters.mjs';
import * as vcs from './git.mjs';

export class Hub {
  constructor(config) {
    check(Array.isArray(config.roots) && Array.isArray(config.targets) && typeof config.state === 'string' && path.isAbsolute(config.state), 'CONFIG', 'Configure roots, targets and absolute state directory');
    const ids = new Set();
    for (const item of [...config.roots, ...config.targets]) {
      check(typeof item.id === 'string' && /^[a-z0-9-]+$/.test(item.id) && !ids.has(item.id) && typeof item.path === 'string' && path.isAbsolute(item.path), 'CONFIG', 'Unique IDs and absolute paths required');
      ids.add(item.id);
    }
    for (const target of config.targets) check(Object.hasOwn(adapters, target.agent), 'CONFIG', 'Target requires a supported Agent adapter');
    const locations = [config.state, ...config.roots.map(x => x.path), ...config.targets.map(x => x.path)].map(x => path.resolve(x));
    for (let i = 0; i < locations.length; i++) for (let j = i + 1; j < locations.length; j++) check(!inside(locations[i], locations[j]) && !inside(locations[j], locations[i]), 'CONFIG', 'State, source and target directories must not overlap');
    this.config = config;
    this.index = new Map();
    this.plans = new Map();
    this.records = {};
    this.blocked = new Set();
    this.queue = Promise.resolve();
  }
  async init() {
    await safePath(this.config.state, '', { missing: true });
    await fs.mkdir(this.config.state, { recursive: true, mode: 0o700 });
    if (await exists(path.join(this.config.state, 'installations.json'))) this.records = JSON.parse(await readText(this.config.state, 'installations.json'));
    // An interrupted transaction is visible and blocks only that installation.
    for (const name of await fs.readdir(this.config.state)) {
      if (name.startsWith('transaction-') && name.endsWith('.json')) {
        const journal = JSON.parse(await readText(this.config.state, name));
        this.blocked.add(journal.key);
      }
    }
    return this;
  }
  async persist() { await atomicWrite(this.config.state, 'installations.json', JSON.stringify(this.records, null, 2)); }
  async exclusive(fn) {
    const running = this.queue.then(fn);
    this.queue = running.catch(() => {});
    return running;
  }
  root(id) {
    const root = this.config.roots.find(x => x.id === id);
    check(root, 'ROOT', 'Unknown root'); return root;
  }
  target(id) {
    const target = this.config.targets.find(x => x.id === id);
    check(target, 'TARGET', 'Unknown target'); return target;
  }
  async skill(id, writable = false) {
    const item = this.index.get(id);
    check(item, 'SKILL', 'Skill not found; rescan');
    const root = this.root(item.root);
    check(!writable || root.writable === true, 'READ_ONLY', 'Root is read-only');
    const dir = await safePath(root.path, item.relative);
    return { item, dir, root };
  }
  async scan() {
    this.index.clear();
    const errors = [];
    for (const root of this.config.roots) {
      try {
        await safePath(root.path);
        let count = 0;
        const walk = async (relative, depth) => {
          check(depth <= 20 && count++ < 10000, 'LIMIT', 'Root scan exceeds directory limit');
          const dir = await safePath(root.path, relative);
          const entries = await fs.readdir(dir, { withFileTypes: true });
          const candidate = entries.some(x => x.name === 'SKILL.md') || (relative && entries.some(x => ['references', 'scripts', 'assets'].includes(x.name)));
          if (candidate) {
            const id = digest(`${root.id}:${relative}`);
            try {
              const text = await readText(dir, 'SKILL.md');
              const files = await tree(dir);
              const result = await validate(text, path.basename(dir), dir);
              result.issues.push(...await security(dir, files));
              const stat = await fs.stat(path.join(dir, 'SKILL.md'));
              this.index.set(id, { id, root: root.id, relative, path: dir, writable: root.writable === true, ...result, contentHash: digest(text), hash: treeHash(files), modified: stat.mtime.toISOString(), files, text });
            } catch (error) {
              this.index.set(id, { id, root: root.id, relative, path: dir, writable: root.writable === true, name: path.basename(dir), description: '', tags: [], agents: [], version: '', domain: '', source: '', files: [], references: [], dependencies: [], issues: [{ code: error.code || 'READ', severity: 'error', message: 'Cannot read Skill: missing file, unsafe path or permission denied' }] });
            }
            return;
          }
          for (const entry of entries) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
            if (entry.isSymbolicLink()) { errors.push({ root: root.id, code: 'LINK', message: 'Skipped symlink or junction' }); continue; }
            if (entry.isDirectory()) await walk(path.join(relative, entry.name), depth + 1);
          }
        };
        await walk('', 0);
      } catch (error) { errors.push({ root: root.id, code: error.code || 'SCAN', message: 'Root unavailable or scan limit exceeded' }); }
    }
    const byName = new Map(), byHash = new Map();
    for (const item of this.index.values()) {
      for (const [map, key] of [[byName, item.name], [byHash, item.hash]]) {
        if (!key) continue;
        const group = map.get(key) || []; group.push(item); map.set(key, group);
      }
    }
    for (const [map, code] of [[byName, 'DUPLICATE_NAME'], [byHash, 'DUPLICATE_CONTENT']]) for (const group of map.values()) if (group.length > 1) for (const item of group) item.issues.push({ code, severity: 'warning', message: 'Duplicate Skill found in another root' });
    return { skills: await this.list(), errors, interrupted: [...this.blocked] };
  }
  async list() {
    const result = [];
    for (const item of this.index.values()) {
      const { text, ...summary } = item;
      const installations = [];
      for (const target of this.config.targets) {
        const record = this.records[`${target.id}/${item.name}`];
        let state = 'not-installed';
        if (this.blocked.has(`${target.id}/${item.name}`)) state = 'interrupted';
        else if (record?.removed) state = await exists(path.join(target.path, item.name)) ? 'unmanaged' : 'uninstalled';
        else if (record) {
          try {
            const dir = await safePath(target.path, item.name);
            state = treeHash(await tree(dir)) !== record.hash ? 'modified' : record.hash !== item.hash ? 'update-available' : 'installed';
          } catch { state = 'missing-or-unsafe'; }
        } else if (await exists(path.join(target.path, item.name))) state = 'unmanaged';
        installations.push({ target: target.id, agent: target.agent, state, recognized: null, loaded: null, executed: null });
      }
      result.push({ ...summary, installations });
    }
    return result;
  }
  async detail(id) {
    const { dir, item } = await this.skill(id);
    let text;
    try { text = await readText(dir, 'SKILL.md'); }
    catch (error) {
      if (item.text !== undefined) throw error;
      return { ...item, text: '', writable: false, contentHash: null, records: [], fileUrl: pathToFileURL(dir).href };
    }
    return { ...item, text, contentHash: digest(text), records: Object.entries(this.records).filter(([key]) => key.endsWith(`/${item.name}`)).map(([key, record]) => ({ key, ...record })), fileUrl: pathToFileURL(path.join(dir, 'SKILL.md')).href };
  }
  async preview(kind, args) {
    const plan = { id: randomUUID(), kind, args, expires: Date.now() + 5 * 60 * 1000 };
    if (['save', 'restore-file'].includes(kind)) {
      const { dir, item } = await this.skill(args.id, true);
      const before = await readText(dir, 'SKILL.md');
      check(args.expected === digest(before), 'CHANGED', 'File changed since it was opened');
      const after = kind === 'restore-file' ? await vcs.historical(dir, args.revision) : args.text;
      check(typeof after === 'string' && Buffer.byteLength(after) <= 2 * 1024 * 1024, 'CONTENT', 'Invalid content');
      const result = await validate(after, path.basename(dir), dir);
      check(!result.issues.some(x => x.severity === 'error'), 'VALIDATION', 'Fix metadata and references before saving', result.issues);
      Object.assign(plan, { before, after, expected: digest(before), directory: dir, skillName: item.name, issues: result.issues });
    } else if (['install', 'uninstall', 'rollback', 'restore-install'].includes(kind)) {
      const { dir, item } = await this.skill(args.id);
      const target = this.target(args.target);
      await safePath(target.path);
      check((await fs.stat(target.path)).isDirectory(), 'TARGET', 'Installation target must be an existing directory');
      compatible(target.agent, item.name);
      check(!item.issues.some(x => x.severity === 'error'), 'VALIDATION', 'Fix Skill validation errors before distribution');
      const key = `${target.id}/${item.name}`;
      check(!this.blocked.has(key), 'INTERRUPTED', 'Interrupted transaction needs manual recovery; see state journal');
      const destination = await safePath(target.path, item.name, { missing: true });
      const present = await exists(destination);
      const record = this.records[key];
      check(!present || (record && !record.removed), 'CONFLICT', 'Target exists and is not managed by Skill Hub');
      const current = present ? await tree(destination) : [];
      if (present) check(treeHash(current) === record.hash, 'CONFLICT', 'Installed files changed outside Skill Hub');
      if (kind === 'restore-install') check(!present && record?.removed, 'MISSING', 'No uninstalled snapshot available');
      else if (kind !== 'install') check(present && record && !record.removed, 'MISSING', 'Managed installation is missing');
      const source = ['rollback', 'restore-install'].includes(kind) ? record.backup : dir;
      if (['rollback', 'restore-install'].includes(kind)) check(typeof source === 'string' && inside(this.config.state, source), 'BACKUP', 'No previous managed version');
      const files = kind === 'uninstall' ? [] : await tree(source);
      if (['rollback', 'restore-install'].includes(kind)) check(treeHash(files) === record.backupHash, 'BACKUP', 'Backup changed outside Skill Hub');
      if (kind === 'install') check(treeHash(files) === item.hash, 'CHANGED', 'Source changed; rescan before installation');
      Object.assign(plan, { key, source, destination, current, files, expected: present ? treeHash(current) : null, sourceHash: treeHash(files), skillName: item.name, record: record || null, issues: item.issues, changes: compareFiles(current, files) });
    } else if (kind === 'tag') {
      const { dir } = await this.skill(args.id, true);
      Object.assign(plan, await vcs.tag(dir, args.name));
      check(await vcs.cleanSkill(dir), 'CHANGED', 'Save and commit all Skill files before tagging');
    } else if (kind === 'draft') {
      const root = this.root(args.root);
      check(root.writable === true, 'READ_ONLY', 'Root is read-only');
      check(typeof args.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.name) && args.name.length <= 64, 'NAME', 'Invalid draft name');
      check(typeof args.text === 'string' && args.text.length < 2 * 1024 * 1024, 'CONTENT', 'Invalid draft text');
      const dir = await safePath(root.path, args.name, { missing: true });
      check(!await exists(dir), 'CONFLICT', 'Draft directory already exists');
      Object.assign(plan, { directory: dir, after: `---\nname: ${args.name}\ndescription: Describe when this skill should be used.\n---\n\n${args.text}`, skillName: args.name });
    } else throw new HubError('OPERATION', 'Unknown preview operation');
    for (const [id, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(id);
    check(this.plans.size < 100, 'LIMIT', 'Too many pending plans');
    this.plans.set(plan.id, plan);
    return plan;
  }
  async confirm(id, confirmed) {
    check(confirmed === true, 'CONFIRMATION', 'Explicit user confirmation required');
    return this.exclusive(async () => {
      const plan = this.plans.get(id);
      check(plan && plan.expires > Date.now(), 'PLAN', 'Plan expired or already consumed');
      this.plans.delete(id);
      if (['save', 'restore-file'].includes(plan.kind)) {
        const { dir } = await this.skill(plan.args.id, true);
        check(dir === plan.directory && digest(await readText(dir, 'SKILL.md')) === plan.expected, 'CHANGED', 'File changed after preview');
        await atomicWrite(dir, 'SKILL.md', plan.after);
      } else if (plan.kind === 'draft') {
        const root = this.root(plan.args.root);
        const dir = await safePath(root.path, plan.args.name, { missing: true });
        await fs.mkdir(dir);
        await atomicWrite(dir, 'SKILL.md', plan.after);
      } else if (plan.kind === 'tag') {
        const { dir } = await this.skill(plan.args.id, true);
        check((await vcs.git(plan.root, ['rev-parse', 'HEAD'])).trim() === plan.hash && await vcs.cleanSkill(dir), 'CHANGED', 'Git state changed after preview');
        await vcs.git(plan.root, ['tag', plan.name, plan.hash]);
      } else await this.applyInstall(plan);
      return { applied: true, kind: plan.kind };
    });
  }
  async applyInstall(plan) {
    const target = this.target(plan.args.target);
    const destination = await safePath(target.path, plan.skillName, { missing: true });
    check(destination === plan.destination, 'PATH', 'Target changed');
    const present = await exists(destination);
    check(present ? treeHash(await tree(destination)) === plan.expected : plan.expected === null, 'CHANGED', 'Installation changed after preview');
    if (plan.kind !== 'uninstall') check(treeHash(await tree(plan.source)) === plan.sourceHash, 'CHANGED', 'Source changed after preview');
    // Stage beside destination for atomic same-volume rename. Journals persist
    // before touching targets; a crash is reported and never declared success.
    const stageName = `.skill-hub-${plan.id}`;
    const stage = await safePath(target.path, stageName, { missing: true });
    const backupName = `backup-${plan.id}`;
    const backup = await safePath(this.config.state, backupName, { missing: true });
    const journalName = `transaction-${plan.id}.json`;
    const oldRecords = structuredClone(this.records);
    await atomicWrite(this.config.state, journalName, JSON.stringify({ key: plan.key, destination, stage, backup, operation: plan.kind, previous: plan.record }));
    let removed = false, installed = false;
    try {
      if (plan.kind !== 'uninstall') await copyTree(plan.source, stage);
      if (present) {
        await copyTree(destination, backup);
        check(treeHash(await tree(destination)) === plan.expected, 'CHANGED', 'Target changed during staging');
        await safePath(target.path, plan.skillName);
        // Mark before deletion: a partial permission failure must retain its
        // journal instead of being treated as an untouched destination.
        removed = true;
        await fs.rm(destination, { recursive: true });
      }
      if (plan.kind !== 'uninstall') {
        await safePath(target.path, plan.skillName, { missing: true });
        check(!await exists(destination), 'CONFLICT', 'Target appeared during installation');
        await fs.rename(stage, destination); installed = true;
        check(treeHash(await tree(destination)) === plan.sourceHash, 'VERIFY', 'Installation verification failed');
        const item = this.index.get(plan.args.id);
        const restored = ['rollback', 'restore-install'].includes(plan.kind);
        this.records[plan.key] = { source: restored ? plan.record.source : item.path, version: plan.kind === 'rollback' ? plan.record.previousVersion : plan.kind === 'restore-install' ? plan.record.version : item.version, previousVersion: plan.record?.version || '', target: destination, hash: plan.sourceHash, backup: present ? backup : null, backupHash: present ? plan.expected : null, time: new Date().toISOString(), method: 'copy', snapshots: [...(plan.record?.snapshots || []), ...(present ? [{ path: backup, version: plan.record.version, hash: plan.expected, time: new Date().toISOString() }] : [])] };
      } else this.records[plan.key] = { ...plan.record, removed: true, backup, backupHash: plan.expected, time: new Date().toISOString(), snapshots: [...(plan.record.snapshots || []), { path: backup, version: plan.record.version, hash: plan.expected, time: new Date().toISOString() }] };
      await this.persist();
      await fs.unlink(await safePath(this.config.state, journalName));
    } catch (error) {
      try {
        if (installed) { await safePath(target.path, plan.skillName); await fs.rm(destination, { recursive: true }); }
        if (removed) await copyTree(backup, destination);
        this.records = oldRecords; await this.persist();
        if (await exists(stage)) { await safePath(target.path, stageName); await fs.rm(stage, { recursive: true }); }
        await fs.unlink(await safePath(this.config.state, journalName));
      } catch { this.blocked.add(plan.key); throw new HubError('INTERRUPTED', 'Recovery failed; inspect persisted transaction journal before retrying'); }
      throw error;
    }
  }
  async dispatch(operation, args = {}) {
    switch (operation) {
      case 'scan': return this.scan();
      case 'detail': return this.detail(args.id);
      case 'config': return { roots: this.config.roots, targets: this.config.targets };
      case 'detect': return Promise.all(['pi', 'codex', 'claude'].map(agent => detect(agent, this.config.executables?.[agent])));
      case 'preview': return this.preview(args.kind, args);
      case 'confirm': return this.confirm(args.plan, args.confirmed);
      case 'history': return vcs.history((await this.skill(args.id)).dir);
      case 'diff': return vcs.changes((await this.skill(args.id)).dir, args.from, args.to);
      case 'file': {
        const { dir, item } = await this.skill(args.id);
        check(item.files.some(file => file.path === args.file), 'FILE', 'File is not indexed');
        return readText(dir, args.file);
      }
      default: throw new HubError('OPERATION', 'Unknown operation');
    }
  }
}
export function compareFiles(before, after) {
  const a = new Map(before.map(x => [x.path, x.hash])), b = new Map(after.map(x => [x.path, x.hash]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap(file => a.get(file) === b.get(file) ? [] : [{ file, change: !a.has(file) ? 'added' : !b.has(file) ? 'removed' : 'modified' }]);
}
