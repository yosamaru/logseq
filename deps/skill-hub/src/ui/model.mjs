export function filterSkills(skills, filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return skills.filter(item => {
    const haystack = [item.name, item.description, item.source, item.path, item.modified, ...item.tags].join(' ').toLocaleLowerCase();
    const states = item.installations.map(x => x.state);
    if (item.issues.some(x => x.severity === 'error')) states.push('validation-failed');
    return (!query || haystack.includes(query)) && (!filters.agent || item.agents.includes(filters.agent) || (!item.agents.length && item.installations.some(x => x.agent === filters.agent))) && (!filters.domain || item.domain === filters.domain) && (!filters.version || item.version === filters.version) && (!filters.status || states.includes(filters.status));
  }).sort((a, b) => filters.sort === 'modified' ? (b.modified || '').localeCompare(a.modified || '') : a.name.localeCompare(b.name));
}
export function lineDiff(before, after) {
  // Bounded linear presentation: common prefix/suffix around the changed region.
  // Keeps large Skills responsive; Git provides full historical patch output.
  const a = before.split('\n'), b = after.split('\n');
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return [...a.slice(Math.max(0, start - 2), start).map(x => ` ${x}`), ...a.slice(start, a.length - end).map(x => `-${x}`), ...b.slice(start, b.length - end).map(x => `+${x}`), ...b.slice(b.length - end, b.length - end + 2).map(x => ` ${x}`)].join('\n');
}
