import { parseDocument } from 'yaml';
import path from 'node:path';
import fs from 'node:fs/promises';
import { safePath, exists } from './files.mjs';

export function metadata(text, directory) {
  const issues = [];
  const add = (code, message, severity = 'error') => issues.push({ code, message, severity });
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  let data = {};
  if (!match) add('FRONTMATTER', 'SKILL.md must start with YAML frontmatter');
  else {
    const doc = parseDocument(match[1], { uniqueKeys: true });
    if (doc.errors.length) add('YAML', 'Invalid YAML frontmatter');
    else {
      try { data = doc.toJS({ maxAliasCount: 30 }); }
      catch { add('YAML', 'YAML aliases exceed limit'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { add('YAML', 'Frontmatter must be a mapping'); data = {}; }
    }
  }
  const name = data.name;
  if (typeof name !== 'string' || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) add('NAME', 'Name must be 1–64 lowercase letters, digits and single hyphens');
  if (name !== directory) add('DIRECTORY', 'Skill name must match its directory');
  if (typeof data.description !== 'string' || !data.description.trim() || data.description.length > 1024) add('DESCRIPTION', 'Description must contain 1–1024 characters');
  if (data.compatibility !== undefined && (typeof data.compatibility !== 'string' || data.compatibility.length > 500)) add('COMPATIBILITY', 'Compatibility must be a string of at most 500 characters');
  for (const key of ['license', 'allowed-tools']) if (data[key] !== undefined && typeof data[key] !== 'string') add('FIELD', `${key} must be a string`);
  if (data.metadata !== undefined && (!data.metadata || Array.isArray(data.metadata) || typeof data.metadata !== 'object' || Object.values(data.metadata).some(x => typeof x !== 'string'))) add('METADATA', 'Metadata values must be strings');
  const extra = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {};
  const list = key => typeof extra[key] === 'string' ? extra[key].split(',').map(x => x.trim()).filter(Boolean) : [];
  if (['context', 'agent', 'hooks', 'disable-model-invocation', 'user-invocable'].some(key => key in data) || /!`[^`]+`/.test(text)) add('PORTABILITY', 'Agent-specific fields or dynamic commands need manual compatibility review', 'warning');
  return { name: typeof name === 'string' ? name : directory, description: typeof data.description === 'string' ? data.description : '', tags: list('tags'), agents: list('agents'), domain: typeof extra.domain === 'string' ? extra.domain : '', version: typeof extra.version === 'string' ? extra.version : '', source: typeof extra.source === 'string' ? extra.source : '', dependencies: list('dependencies'), issues };
}
export async function validate(text, directory, base) {
  const result = metadata(text, directory);
  const refs = new Set();
  for (const match of text.matchAll(/!?\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\)/g)) refs.add(match[1]);
  for (const match of text.matchAll(/^\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)) refs.add(match[1]);
  for (const match of text.matchAll(/`((?:references|scripts|assets)\/[^`\n]+)`/g)) refs.add(match[1]);
  result.references = [];
  for (const reference of refs) {
    if (/^(https?:|mailto:|#)/i.test(reference)) continue;
    try {
      const relative = decodeURIComponent(reference.split('#')[0]);
      const file = await safePath(base, relative, { missing: true });
      if (!await exists(file)) throw new Error('Missing');
      result.references.push({ path: relative, exists: true });
    } catch {
      result.references.push({ path: reference, exists: false });
      result.issues.push({ code: 'REFERENCE', severity: 'error', message: `Missing or unsafe reference: ${reference}` });
    }
  }
  return result;
}
export async function security(base, files) {
  const issues = [];
  const rules = [
    ['DESTRUCTIVE', /\b(?:rm\s+-[^\n]*r|Remove-Item[^\n]*-Recurse|git\s+(?:reset\s+--hard|clean\s+-))/i],
    ['REMOTE_EXEC', /(?:curl|wget)[^\n]*\|\s*(?:sh|bash|powershell)|Invoke-Expression|\biex\s*\(/i],
    ['CREDENTIAL', /-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[a-zA-Z0-9]{24,}|AKIA[A-Z0-9]{16})\b/],
    ['EXFILTRATION', /(?:upload|send|exfiltrate|上传|发送)[^\n]{0,100}(?:secret|token|credential|\.ssh|密钥)/i]
  ];
  for (const file of files) {
    if (/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?)$/i.test(file.path)) issues.push({ code: 'SENSITIVE_FILE', severity: 'warning', message: `${file.path}: potentially sensitive file will be included in distribution` });
    if (!/\.(?:md|txt|sh|ps1|py|js|mjs|json|ya?ml)$/i.test(file.path) || file.size > 1024 * 1024) continue;
    const text = await fs.readFile(await safePath(base, file.path), 'utf8');
    for (const [code, pattern] of rules) if (pattern.test(text)) issues.push({ code, severity: 'warning', message: `${file.path}: static risk rule ${code}; review before use` });
  }
  return issues;
}
