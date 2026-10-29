// The bundled view and its Logseq host are same-origin. Copy theme tokens only;
// never copy host markup or theme scripts into the Skill preview document.
export function followHostTheme() {
  const host = parent.document;
  const root = document.documentElement;
  let copied = new Set();
  let scheduled;
  const sync = () => {
    scheduled = undefined;
    const styles = parent.getComputedStyle(host.body);
    const next = new Set();
    for (const property of styles) {
      if (!property.startsWith('--')) continue;
      next.add(property);
      root.style.setProperty(property, styles.getPropertyValue(property));
    }
    for (const property of copied) if (!next.has(property)) root.style.removeProperty(property);
    copied = next;
    root.style.fontFamily = styles.fontFamily;
    root.style.fontSize = styles.fontSize;
    root.style.colorScheme = host.documentElement.dataset.theme || styles.colorScheme;
  };
  const schedule = () => { scheduled ??= requestAnimationFrame(sync); };
  const observer = new MutationObserver(schedule);
  observer.observe(host.documentElement, { attributes: true });
  observer.observe(host.body, { attributes: true });
  observer.observe(host.head, { subtree: true, childList: true, characterData: true, attributes: true });
  host.addEventListener('load', schedule, true);
  parent.addEventListener('resize', schedule);
  sync();
  addEventListener('pagehide', () => {
    observer.disconnect();
    host.removeEventListener('load', schedule, true);
    parent.removeEventListener('resize', schedule);
    if (scheduled !== undefined) cancelAnimationFrame(scheduled);
  }, { once: true });
}
