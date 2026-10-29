import { marked } from './vendor/marked.esm.js';
import DOMPurify from './vendor/purify.es.mjs';
import { translator } from './i18n.mjs';
import { filterSkills, lineDiff } from './model.mjs';
import { call, host as sdk } from './native-bridge.mjs';

const app = document.querySelector('#app');
const state = { skills: [], selected: null, config: null, query: '', agent: '', domain: '', version: '', status: '', sort: 'name', view: 'list', busy: false, dirty: false, draft: '' };
let t;
let selectedNote = null;
const el = (tag, text, attrs = {}) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};
const button = (key, fn) => { const node = el('button', t(key), { type: 'button' }); node.onclick = () => run(fn); return node; };
function label(key, input) { const node = el('label', t(key)); node.append(input); return node; }
function input(key, value = '', type = 'text') { return el('input', undefined, { type, value, 'aria-label': t(key) }); }
function notice(message, error = false) {
  const node = document.querySelector('#notice');
  node.textContent = message; node.className = error ? 'error' : 'muted';
}
async function rpc(operation, args = {}) {
  const body = await call('rpc', { operation, args });
  if (body.error) throw new Error(`${body.error.code}: ${body.error.message}${body.error.details ? '\n' + body.error.details.map(issue => `${issue.code}: ${issue.message}`).join('\n') : ''}`);
  return body.result;
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true; notice(t('loading'));
  document.querySelectorAll('button').forEach(node => { node.disabled = true; });
  try { await fn(); }
  catch (error) { notice(`${t('error')}: ${error.message}`, true); }
  finally { state.busy = false; document.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
}
function canDiscard() { return !state.dirty || globalThis.confirm(t('discarded')); }
async function scan() {
  const result = await rpc('scan'); state.skills = result.skills;
  render();
  notice(result.errors.length || result.interrupted.length ? JSON.stringify({ errors: result.errors, interrupted: result.interrupted }) : `${state.skills.length} ${t('count')}`);
}
function dropdown(key, values, current, change) {
  const select = el('select', undefined, { 'aria-label': t(key) });
  select.append(el('option', t('all'), { value: '' }));
  for (const value of [...new Set(values.filter(Boolean))].sort()) select.append(el('option', value, { value }));
  select.value = current; select.onchange = () => change(select.value);
  return label(key, select);
}
function render() {
  app.replaceChildren();
  const header = el('header'); header.append(el('h1', t('title')));
  header.append(button('close', () => { if (canDiscard()) sdk.hideMainUI(); }));
  app.append(header, el('p', '', { id: 'notice', role: 'status', 'aria-live': 'polite' }));
  const configuration = el('div', undefined, { class: 'toolbar' });
  configuration.append(button('addRoot', () => showDirectory('root')), button('addTarget', () => showDirectory('target')));
  app.append(configuration);
  if (!state.config) return;
  const toolbar = el('div', undefined, { class: 'toolbar' });
  const search = input('search', state.query); search.placeholder = t('search');
  search.oninput = () => { state.query = search.value; renderList(); };
  toolbar.append(search);
  for (const [key, values] of [['agent', ['pi', 'codex', 'claude']], ['domain', state.skills.map(x => x.domain)], ['version', state.skills.map(x => x.version)], ['status', ['installed', 'not-installed', 'uninstalled', 'update-available', 'modified', 'unmanaged', 'validation-failed', 'interrupted']]]) toolbar.append(dropdown(key, values, state[key], value => { state[key] = value; renderList(); }));
  const sort = el('select', undefined, { 'aria-label': t('sort') });
  for (const key of ['name', 'modified']) sort.append(el('option', t(key), { value: key }));
  sort.value = state.sort; sort.onchange = () => { state.sort = sort.value; renderList(); };
  toolbar.append(label('sort', sort), button('list', () => { state.view = 'list'; renderList(); }), button('cards', () => { state.view = 'cards'; renderList(); }), button('refresh', async () => { if (!canDiscard()) return; state.dirty = false; await scan(); if (state.selected) await select(state.selected.id); }), button('detect', async () => showText(t('detect'), JSON.stringify(await rpc('detect'), null, 2))), button('draft', showDraft));
  app.append(toolbar);
  const layout = el('div', undefined, { class: 'layout' }); layout.append(el('aside', undefined, { id: 'skills' }), el('main', undefined, { id: 'detail' })); app.append(layout);
  renderList();
  if (state.selected) renderDetail(); else document.querySelector('#detail').append(el('p', t('select')));
}
function renderList() {
  const node = document.querySelector('#skills'); if (!node) return;
  node.replaceChildren();
  const items = filterSkills(state.skills, state);
  node.append(el('p', `${items.length} ${t('count')}`, { class: 'muted' }));
  if (!items.length) node.append(el('p', t('empty')));
  const list = el('div', undefined, { class: state.view === 'cards' ? 'cards' : 'list' });
  for (const item of items) {
    const row = el('button', undefined, { type: 'button', class: 'skill', 'aria-pressed': String(state.selected?.id === item.id) });
    row.append(el('strong', item.name), el('span', item.description), el('small', [item.version, ...item.tags, ...item.agents, item.issues.length ? `${item.issues.length} !` : ''].filter(Boolean).join(' · ')), el('small', item.source || item.path, { class: 'path' }), el('small', item.installations.map(x => `${x.agent}: ${x.state}`).join(' · ')));
    row.onclick = () => run(async () => { if (canDiscard()) await select(item.id); }); list.append(row);
  }
  node.append(list);
}
async function select(id) { state.selected = await rpc('detail', { id }); state.dirty = false; state.draft = state.selected.text; renderDetail(); renderList(); notice(''); }
function section(parent, key, text) { parent.append(el('h3', t(key)), el('p', text, { class: 'path' })); }
function renderDetail() {
  const item = state.selected, parent = document.querySelector('#detail'); parent.replaceChildren();
  parent.append(el('h2', item.name), el('p', item.description));
  const source = el('a', item.path, { href: item.fileUrl });
  source.onclick = event => { event.preventDefault(); run(() => sdk.reveal(item.id)); };
  parent.append(el('h3', t('source')), source);
  for (const [key, value] of [['version', item.version], ['agent', item.agents.join(', ')], ['tags', item.tags.join(', ')], ['dependencies', item.dependencies.join(', ')]]) if (value) section(parent, key, value);
  parent.append(el('h3', t('validation')), el('p', t('risk'), { class: 'muted' }));
  for (const issue of item.issues) parent.append(el('p', `${issue.code}: ${issue.message}`, { class: 'issue' }));
  if (!item.issues.length) parent.append(el('p', t('valid')));
  section(parent, 'references', item.references.map(x => `${x.exists ? '✓' : '!'} ${x.path}`).join('\n'));
  const files = el('div', undefined, { class: 'actions' });
  for (const file of item.files) { const node = el('button', file.path, { type: 'button' }); node.onclick = () => run(async () => showText(t('readFile'), await rpc('file', { id: item.id, file: file.path }))); files.append(node); }
  parent.append(el('h3', t('files')), files);
  const summary = state.skills.find(x => x.id === item.id);
  section(parent, 'disk', (summary?.installations || []).map(x => `${x.agent} / ${x.target}: ${x.state}`).join('\n'));
  parent.append(el('p', t('unknown'), { class: 'muted' }));
  const targets = el('select', undefined, { 'aria-label': t('target') });
  for (const target of state.config.targets) targets.append(el('option', `${target.agent} · ${target.path}`, { value: target.id }));
  parent.append(label('target', targets));
  const installActions = el('div', undefined, { class: 'actions' });
  for (const kind of ['install', 'uninstall', 'rollback', 'restore-install']) installActions.append(button(kind, async () => showPlan(await rpc('preview', { kind, id: item.id, target: targets.value }))));
  installActions.append(button('records', () => showText(t('records'), JSON.stringify(item.records, null, 2))));
  parent.append(installActions, el('h3', t('editor')), el('p', item.writable ? t('schema') : t('readonly'), { class: 'muted' }));
  const editor = el('textarea', undefined, { 'aria-label': t('editor'), spellcheck: 'false' }); editor.value = state.draft || item.text; editor.readOnly = !item.writable;
  editor.oninput = () => { state.draft = editor.value; state.dirty = editor.value !== item.text; };
  parent.append(editor);
  const edits = el('div', undefined, { class: 'actions' });
  if (item.writable) edits.append(button('save', async () => showPlan(await rpc('preview', { kind: 'save', id: item.id, text: editor.value, expected: item.contentHash }))), button('undo', () => { editor.value = item.text; state.draft = item.text; state.dirty = false; }));
  edits.append(button('preview', () => showMarkdown(editor.value)), button('history', showHistory), button('diff', async () => showText(t('diff'), await rpc('diff', { id: item.id })))); parent.append(edits);
  const page = input('pageName', `Skills/${item.name}`);
  parent.append(label('pageName', page), button('link', async () => {
    if (!page.value.trim()) return;
    let entity = await sdk.Editor.getPage(page.value);
    if (!entity) entity = await sdk.Editor.createPage(page.value, {}, { createFirstBlock: false });
    if (!entity) throw new Error(t('error'));
    // Only a knowledge link. Never copy the Skill body into the graph.
    const block = await sdk.Editor.insertBlock(entity.uuid, `[${item.name}](${item.fileUrl})`, { sibling: false });
    if (!block) throw new Error(t('error'));
    notice(t('linked'));
  }));
}
function dialog(title) {
  const node = el('dialog', undefined, { 'aria-label': title }); node.append(el('h2', title)); document.body.append(node);
  node.addEventListener('close', () => node.remove()); node.showModal(); return node;
}
function showText(title, text) { const node = dialog(title); node.append(el('pre', text || t('noChanges')), button('close', () => node.close())); }
function showMarkdown(text) {
  const node = dialog(t('preview')), body = el('div', undefined, { class: 'markdown' });
  // Skill markup is untrusted. Block images and raw link destinations to prevent
  // credential tracking, local file reads or javascript navigation on preview.
  body.innerHTML = DOMPurify.sanitize(marked.parse(text), {
    ALLOWED_TAGS: ['p', 'div', 'span', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'pre', 'code', 'blockquote', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'br', 'del', 's', 'sup', 'sub'],
    ALLOWED_ATTR: []
  });
  node.append(body, button('close', () => node.close()));
}
function showPlan(plan) {
  const node = dialog(t('plan'));
  node.append(el('p', `${plan.kind} · ${plan.skillName || plan.name}`), el('pre', plan.destination || plan.directory || `${plan.root}\n${plan.hash}`), el('p', t('expires')));
  if (plan.before !== undefined) node.append(el('h3', t('changes')), el('pre', lineDiff(plan.before, plan.after)));
  else if (plan.after !== undefined) node.append(el('pre', plan.after));
  if (plan.changes) node.append(el('h3', t('changes')), el('pre', plan.changes.map(x => `${x.change}\t${x.file}`).join('\n') || t('noChanges')));
  for (const issue of plan.issues || []) node.append(el('p', `${issue.code}: ${issue.message}`, { class: 'issue' }));
  node.append(button('cancel', () => node.close()), button('confirm', async () => {
    await rpc('confirm', { plan: plan.id, confirmed: true }); node.close(); state.dirty = false;
    await scan(); if (state.selected) await select(state.selected.id); notice(t('saved'));
  }));
}
async function showHistory() {
  const id = state.selected.id, entries = await rpc('history', { id });
  const node = dialog(t('history'));
  if (!entries.length) node.append(el('p', t('noHistory')));
  const from = el('select', undefined, { 'aria-label': t('from') }), to = el('select', undefined, { 'aria-label': t('to') });
  for (const entry of entries) {
    for (const select of [from, to]) select.append(el('option', `${entry.hash.slice(0, 9)} ${entry.subject}`, { value: entry.hash }));
    const row = el('div', undefined, { class: 'history-row' }); row.append(el('span', `${entry.date} ${entry.hash.slice(0, 9)} ${entry.subject}`));
    if (state.selected.writable) row.append(button('restore', async () => { if (canDiscard()) showPlan(await rpc('preview', { kind: 'restore-file', id, revision: entry.hash, expected: state.selected.contentHash })); })); node.append(row);
  }
  node.append(label('from', from), label('to', to), button('compare', async () => showText(t('compare'), await rpc('diff', { id, from: from.value, to: to.value }))));
  if (state.selected.writable) { const name = input('tagName'); node.append(label('tagName', name), button('tag', async () => showPlan(await rpc('preview', { kind: 'tag', id, name: name.value })))); }
  node.append(button('close', () => node.close()));
}
function showDraft() {
  const node = dialog(t('draft'));
  const root = el('select', undefined, { 'aria-label': t('root') });
  for (const item of state.config.roots.filter(x => x.writable === true)) root.append(el('option', item.path, { value: item.id }));
  const name = input('draftName'), text = el('textarea', undefined, { 'aria-label': t('draftText') });
  node.append(el('p', t('draftHint')), label('root', root), label('draftName', name), label('draftText', text), button('exportNote', () => {
    if (!selectedNote) throw new Error(t('missingNote'));
    text.value = selectedNote.content ?? selectedNote.title ?? '';
  }), button('draftPreview', async () => showPlan(await rpc('preview', { kind: 'draft', root: root.value, name: name.value, text: text.value }))), button('close', () => node.close()));
}
function showDirectory(kind) {
  const node = dialog(t(kind === 'root' ? 'addRoot' : 'addTarget'));
  const writable = input('rootWritable', '', 'checkbox');
  const agent = el('select', undefined, { 'aria-label': t('agent') });
  for (const value of ['pi', 'codex', 'claude']) agent.append(el('option', value, { value }));
  node.append(el('p', t(kind === 'root' ? 'rootHint' : 'targetHint')));
  node.append(kind === 'root' ? label('rootWritable', writable) : label('agent', agent));
  node.append(button('cancel', () => node.close()), button('chooseDirectory', async () => {
    if (!canDiscard()) return;
    const result = await call('directory', { kind, writable: writable.checked, agent: agent.value });
    if (result.error) throw new Error(result.error.message);
    if (result.result.cancelled) return;
    node.close(); state.config = await rpc('config'); state.selected = null; state.dirty = false; await scan();
  }));
}
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]') && canDiscard()) sdk.hideMainUI();
});
globalThis.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function main() {
  const startup = await call('startup');
  t = translator(startup.translations);
  selectedNote = startup.note;
  render();
  await run(async () => { state.config = await rpc('config'); await scan(); });
}
main().catch(error => { app.textContent = error.message; });
