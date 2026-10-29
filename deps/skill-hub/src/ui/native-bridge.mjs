const channel = 'logseq-skill-hub';
const origin = globalThis.location.origin;
const pending = new Map();
globalThis.addEventListener('message', event => {
  if (event.source !== globalThis.parent || event.origin !== origin || event.data?.channel !== channel) return;
  const entry = pending.get(event.data.id);
  if (!entry) return;
  pending.delete(event.data.id); clearTimeout(entry.timer);
  if (event.data.error) entry.reject(new Error(event.data.error.message));
  else entry.resolve(event.data.result);
});
export function call(operation, args = {}) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Skill Hub host request timed out')); }, 45000);
    pending.set(id, { resolve, reject, timer });
    globalThis.parent.postMessage({ channel, id, operation, args }, origin);
  });
}
export const host = {
  Editor: {
    getCurrentBlock: () => call('editor', { method: 'getCurrentBlock', args: [] }),
    getPage: name => call('editor', { method: 'getPage', args: [name] }),
    createPage: (name, properties, options) => call('editor', { method: 'createPage', args: [name, properties, options] }),
    insertBlock: (uuid, text, options) => call('editor', { method: 'insertBlock', args: [uuid, text, options] })
  },
  hideMainUI: () => call('close'),
  reveal: id => call('reveal', { id })
};
