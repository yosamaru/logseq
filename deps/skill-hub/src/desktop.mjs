import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hub } from './hub.mjs';
import { safePath, exists, atomicWrite, check } from './files.mjs';
import { adapters } from './adapters.mjs';

// Owned by Electron main. No sockets, child server or plugin SDK. One instance
// serializes every request across all app windows and writes only declared roots.
export class DesktopHub {
  constructor(userData) {
    check(path.isAbsolute(userData), 'CONFIG', 'Absolute application data directory required');
    this.userData = userData;
    this.configFile = 'skill-hub-config.json';
    this.queue = Promise.resolve();
    this.hub = null;
  }
  async init() {
    if (this.hub) return this.hub;
    await safePath(this.userData);
    let config;
    if (await exists(path.join(this.userData, this.configFile))) {
      config = JSON.parse(await fs.readFile(await safePath(this.userData, this.configFile), 'utf8'));
    } else {
      const source = path.join(this.userData, 'agent-skills');
      await safePath(this.userData, 'agent-skills', { missing: true });
      await fs.mkdir(source, { recursive: true });
      config = { state: path.join(this.userData, 'skill-hub-state'), roots: [{ id: 'personal', path: source, writable: true }], targets: [], executables: {} };
      await atomicWrite(this.userData, this.configFile, JSON.stringify(config, null, 2));
    }
    this.hub = await new Hub(config).init();
    return this.hub;
  }
  async request(operation, args = {}) {
    const task = this.queue.then(async () => {
      try {
        const hub = await this.init();
        return { result: await hub.dispatch(operation, args) };
      } catch (error) {
        // Return failures as data. The generic Electron handler logs rejected
        // IPC arguments, which could otherwise contain an edited Skill body.
        const known = typeof error.code === 'string' && !/^E[A-Z]+$/.test(error.code);
        return { error: { code: error.code || 'INTERNAL', message: known ? error.message : 'Local operation failed; check directories, permissions and Git', ...(known && error.details ? { details: error.details } : {}) } };
      }
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  async authorizeDirectory(kind, selected, { writable = false, agent } = {}) {
    const task = this.queue.then(async () => {
      const hub = await this.init();
      await safePath(selected);
      check((await fs.stat(selected)).isDirectory(), 'PATH', 'Select an existing directory');
      check(['root', 'target'].includes(kind), 'CONFIG', 'Unknown directory purpose');
      if (kind === 'target') check(Object.hasOwn(adapters, agent), 'ADAPTER', 'Choose a supported Agent');
      const config = structuredClone(hub.config);
      const item = { id: `${kind}-${randomUUID()}`, path: selected, ...(kind === 'root' ? { writable: writable === true } : { agent }) };
      config[kind === 'root' ? 'roots' : 'targets'].push(item);
      const next = await new Hub(config).init();
      await atomicWrite(this.userData, this.configFile, JSON.stringify(config, null, 2));
      // Old preview IDs intentionally expire when permissions/config change.
      this.hub = next;
      return item;
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}
