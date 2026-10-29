const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const lifecycle = require('../index.cjs');

async function holdFile(directory, file, milliseconds) {
  const script = path.join(directory, 'hold.ps1');
  fs.writeFileSync(script, '$stream=[IO.File]::Open($args[0],[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite); '
    + '[Console]::WriteLine("LOCKED"); Start-Sleep -Milliseconds ([int]$args[1]); $stream.Dispose()');
  const child = spawn('powershell.exe', ['-NoProfile', '-File', script, file, String(milliseconds)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostic = '';
  child.stderr.on('data', data => { diagnostic += data; });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(diagnostic)));
  });
  await Promise.race([
    new Promise(resolve => child.stdout.once('data', data => { assert.match(String(data), /LOCKED/); resolve(); })),
    closed.then(() => { throw new Error('File holder exited before acquiring the lock'); })
  ]);
  return { closed };
}

test('Windows lifecycle lease survives a temporary reader denying atomic replacement',
  { skip: process.platform !== 'win32' }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-reader-'));
    try {
      const storage = lifecycle.resolveStorage(root, path.join(root, 'graphs'));
      const generation = await lifecycle.createGraph(storage, 'startup');
      const ctx = lifecycle.context(storage, 'startup');
      const reader = await holdFile(root, ctx.stateFile, 300);
      try {
        await lifecycle.withLease(ctx, 'start', async () => {
          assert.equal(lifecycle.snapshot(storage, 'startup').owner.operation, 'start');
        });
      } finally { await reader.closed; }
      const restored = lifecycle.snapshot(storage, 'startup');
      assert.equal(restored.generation, generation);
      assert.equal(restored.owner, undefined);
      assert.equal(restored.phase, 'available');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

test('Windows persistent file locks fail without overwriting prior state or leaking the lease',
  { skip: process.platform !== 'win32' }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-lock-'));
    try {
      const storage = lifecycle.resolveStorage(root, path.join(root, 'graphs'));
      await lifecycle.createGraph(storage, 'startup');
      const ctx = lifecycle.context(storage, 'startup');
      const previous = fs.readFileSync(ctx.stateFile, 'utf8');
      const reader = await holdFile(root, ctx.stateFile, 2000);
      try {
        await assert.rejects(lifecycle.withLease(ctx, 'start', async () => assert.fail('Lock must prevent admission')),
          error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
        assert.equal(fs.readFileSync(ctx.stateFile, 'utf8'), previous);
        assert.deepEqual(fs.readdirSync(ctx.dir).filter(file => file.endsWith('.tmp')), []);
      } finally { await reader.closed; }
      await lifecycle.withLease(ctx, 'start', async () => {});
      assert.equal(lifecycle.snapshot(storage, 'startup').owner, undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
