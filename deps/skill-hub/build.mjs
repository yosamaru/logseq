import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { createRequire } from 'node:module';
import { build } from 'vite';

const base = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const packageRoot = name => path.resolve(path.dirname(require.resolve(name)), '..');
const core = process.argv.includes('--core');
const output = core ? path.join(base, '../../static/skill-hub') : path.join(base, 'dist');
await fs.mkdir(path.join(output, 'vendor'), { recursive: true });
for (const file of ['index.html', 'app.mjs', 'model.mjs', 'i18n.mjs', 'native-bridge.mjs', 'style.css']) await fs.copyFile(path.join(base, 'src/ui', file), path.join(output, file));
await fs.copyFile(path.join(packageRoot('marked'), 'lib/marked.esm.js'), path.join(output, 'vendor/marked.esm.js'));
await fs.copyFile(path.join(packageRoot('dompurify'), 'dist/purify.es.mjs'), path.join(output, 'vendor/purify.es.mjs'));
for (const [pkg, name] of [['marked', 'LICENSE.md'], ['dompurify', 'LICENSE'], ['yaml', 'LICENSE']]) await fs.copyFile(path.join(packageRoot(pkg), name), path.join(output, 'vendor', `${pkg}.LICENSE`));
await fs.copyFile(path.join(base, '../../LICENSE.md'), path.join(output, 'LICENSE.md'));
await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir: core ? path.join(base, '../../static/js') : path.join(base, 'dist/runtime'),
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    lib: { entry: path.join(base, 'src/desktop.mjs'), formats: ['cjs'], fileName: () => 'skill-hub.cjs' },
    rolldownOptions: { external: [...builtinModules, ...builtinModules.map(name => `node:${name}`)] }
  }
});
console.info(core ? 'Built native Skill Hub UI and Electron runtime into static/.' : 'Built Skill Hub test UI and CJS runtime into dist/.');
