import { mount, render, type Mounted } from 'pele';

const sources = new WeakMap<HTMLElement, string>();
const mounted = new Map<HTMLElement, Mounted>();
let removalObserver: MutationObserver | undefined;
let diagramId = 0;

function observeRemovals() {
  if (removalObserver) return;
  removalObserver = new MutationObserver(() => {
    for (const [node, diagram] of mounted) {
      if (node.isConnected) continue;
      diagram.destroy();
      mounted.delete(node);
    }
    if (mounted.size === 0) {
      removalObserver?.disconnect();
      removalObserver = undefined;
    }
  });
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
}

/** Render Mermaid fences with Pele, including detached export documents. */
export function applyDiagrams(root: HTMLElement): void {
  for (const node of root.querySelectorAll<HTMLElement>('pre.mermaid')) {
    // Never parse labels from an SVG (or an error message) as diagram source.
    const previous = sources.get(node);
    const source = previous !== undefined && node.querySelector(':scope > .pele')
      ? previous
      : (node.textContent || '').trim();
    const current = mounted.get(node);
    if (current && current.source === source && node.querySelector(':scope > .pele')) {
      current.refresh();
      continue;
    }
    current?.destroy();
    mounted.delete(node);
    sources.set(node, source);
    if (!source) continue;

    if (node.isConnected) {
      // Pele observes width and font changes, including diagrams in hidden tabs.
      mounted.set(node, mount(node, source, { zoom: false }));
      observeRemovals();
    } else {
      // Exports need SVG immediately and must not retain DOM observers.
      const style = getComputedStyle(document.documentElement);
      try {
        node.innerHTML = render(source, {
          idPrefix: `td-mermaid-${++diagramId}`,
          fontFamily: style.getPropertyValue('--font-ui').trim() || 'sans-serif',
          fontFamilyMono: style.getPropertyValue('--font-mono').trim() || 'monospace',
        }).svg;
      } catch (error) {
        const message = document.createElement('span');
        message.className = 'pele pele-error';
        message.textContent = error instanceof Error ? error.message : source;
        node.replaceChildren(message);
      }
    }
  }
}
