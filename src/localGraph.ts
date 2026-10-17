// The local graph: the open note, the notes it links to and the notes linking
// to it, drawn as an SVG with the note in the middle and its neighbours on
// rings around it, colored by note type.

export type GraphNote = {
  id: string;
  title: string;
  /** Its type's name, "Journal" for a journal page, or "" for a plain note. */
  kind: string;
};

type GraphOptions = {
  /** The open note first, then its neighbours. */
  notes: GraphNote[];
  /** Links as `[from, to]` ids. */
  links: Array<[string, string]>;
  /** Neighbours left out. */
  hidden: number;
  /** Every type's name in a stable order, so a type keeps its color from graph to graph. */
  kinds: string[];
  /** A kind's icon as HTML, for the legend. */
  iconOf: (kind: string) => string;
  open: (id: string, event: MouseEvent | KeyboardEvent) => void;
};

const WIDTH = 900;
const HEIGHT = 560;
/** Neighbours on the inner ring before a second ring starts. */
const INNER = 12;
const LABEL_CHARS = 18;
// The tag colors' dots (main.ts TAG_COLORS); plain notes are slate.
const PALETTE = ['oklch(0.6 0.16 256)', 'oklch(0.62 0.11 195)', 'oklch(0.6 0.14 145)', 'oklch(0.62 0.18 18)', 'oklch(0.6 0.18 295)'];
const JOURNAL_COLOR = 'oklch(0.7 0.13 70)';
const PLAIN_COLOR = 'oklch(0.58 0.025 80)';

type Point = { x: number; y: number };

/**
 * Where `count` neighbours go around the middle of the graph: one ellipse
 * (wider than tall, since labels run sideways), or two when there are more
 * than fit on the first, the outer one turned half a step.
 */
export function ringLayout(count: number, width = WIDTH, height = HEIGHT): Point[] {
  const middle = { x: width / 2, y: height / 2 };
  const ring = (n: number, rx: number, ry: number, turn: number) => Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + ((i + turn) / n) * Math.PI * 2;
    return { x: middle.x + rx * Math.cos(angle), y: middle.y + ry * Math.sin(angle) };
  });
  if (count <= INNER) return ring(count, width * 0.26, height * 0.32, 0);
  return [...ring(INNER, width * 0.19, height * 0.2, 0), ...ring(count - INNER, width * 0.35, height * 0.4, 0.5)];
}

/** A kind's color: its place among the vault's types; journal pages amber, plain notes slate. */
export function kindColor(kind: string, kinds: string[]) {
  if (!kind) return PLAIN_COLOR;
  if (kind === 'Journal') return JOURNAL_COLOR;
  const at = kinds.findIndex((k) => k.toLowerCase() === kind.toLowerCase());
  return PALETTE[(at < 0 ? kinds.length : at) % PALETTE.length];
}

function shorten(title: string) {
  return title.length > LABEL_CHARS ? `${title.slice(0, LABEL_CHARS - 1).trimEnd()}…` : title;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function openLocalGraph(options: GraphOptions) {
  document.querySelector('.graph-dialog')?.remove();
  const [center, ...neighbours] = options.notes;
  // Same-type notes sit together on the ring.
  neighbours.sort((a, b) => (a.kind || '￿').localeCompare(b.kind || '￿') || a.title.localeCompare(b.title));
  const points = new Map<string, Point>([[center.id, { x: WIDTH / 2, y: HEIGHT / 2 }]]);
  ringLayout(neighbours.length).forEach((point, i) => points.set(neighbours[i].id, point));

  // A link both ways is one line with two arrowheads.
  const pairs = new Map<string, { from: string; to: string; both: boolean }>();
  for (const [from, to] of options.links) {
    const back = pairs.get(`${to}>${from}`);
    if (back) back.both = true;
    else pairs.set(`${from}>${to}`, { from, to, both: false });
  }
  const radius = (id: string) => (id === center.id ? 15 : 8);
  const lines = [...pairs.values()].map(({ from, to, both }) => {
    const [a, b] = [points.get(from)!, points.get(to)!];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const [ux, uy] = [(b.x - a.x) / length, (b.y - a.y) / length];
    const [ra, rb] = [radius(from) + 3, radius(to) + 3];
    const touches = from === center.id || to === center.id;
    return `<line class="graph-link${touches ? '' : ' is-side'}" data-from="${escapeHtml(from)}" data-to="${escapeHtml(to)}"
      x1="${(a.x + ux * ra).toFixed(1)}" y1="${(a.y + uy * ra).toFixed(1)}" x2="${(b.x - ux * rb).toFixed(1)}" y2="${(b.y - uy * rb).toFixed(1)}"
      marker-end="url(#graph-arrow)"${both ? ' marker-start="url(#graph-arrow-back)"' : ''} />`;
  }).join('');

  const node = (note: GraphNote) => {
    const point = points.get(note.id)!;
    const isCenter = note.id === center.id;
    // Labels point away from the middle so neighbours' labels don't run into it.
    const side = isCenter ? 0 : Math.sign(Math.round(point.x - WIDTH / 2));
    const [lx, ly, anchor] = isCenter ? [point.x, point.y + 32, 'middle']
      : side > 0 ? [point.x + 13, point.y + 4, 'start']
      : side < 0 ? [point.x - 13, point.y + 4, 'end']
      : [point.x, point.y + (point.y < HEIGHT / 2 ? -14 : 22), 'middle'];
    const title = note.title || 'Untitled';
    return `<g class="graph-node${isCenter ? ' is-center' : ''}" data-id="${escapeHtml(note.id)}" role="link" tabindex="0" aria-label="Open ${escapeHtml(title)}">
      <title>${escapeHtml(title)}${note.kind ? ` · ${escapeHtml(note.kind)}` : ''}</title>
      <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${radius(note.id)}" fill="${kindColor(note.kind, options.kinds)}" />
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${escapeHtml(isCenter ? title : shorten(title))}</text>
    </g>`;
  };

  const kinds = [...new Set(options.notes.map((n) => n.kind))].sort((a, b) => (a || '￿').localeCompare(b || '￿'));
  const legend = kinds.map((kind) => `<span class="graph-kind"><i style="background:${kindColor(kind, options.kinds)}"></i>${kind ? `${options.iconOf(kind)}${escapeHtml(kind)}` : 'Other notes'}</span>`).join('');
  const more = options.hidden ? `<span class="graph-more">${options.hidden} more not shown, the least recently edited.</span>` : '';

  const dialog = document.createElement('dialog');
  dialog.className = 'task-list-dialog graph-dialog';
  dialog.setAttribute('aria-label', 'Graph');
  dialog.innerHTML = `
    <div class="task-list-shell">
      <header class="task-list-head">
        <div><h2>Graph</h2><span>Notes “${escapeHtml(center.title || 'Untitled')}” links to, and notes that link to it. Click one to open it; ⌘-click opens a new tab.</span></div>
        <button type="button" class="history-close" aria-label="Close" data-close>×</button>
      </header>
      <div class="graph-body">
        ${neighbours.length ? '' : '<p class="graph-empty">No links yet. Link to another note with <code>[[Title]]</code>, and it shows up here.</p>'}
        <svg class="graph-svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="group" aria-label="Linked notes">
          <defs>
            <marker id="graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" /></marker>
            <marker id="graph-arrow-back" viewBox="0 0 8 8" refX="1" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M8 0L0 4L8 8z" /></marker>
          </defs>
          <g class="graph-links">${lines}</g>
          <g class="graph-nodes">${neighbours.map(node).join('')}${node(center)}</g>
        </svg>
      </div>
      <footer class="graph-legend">${legend}${more}</footer>
    </div>`;
  document.body.append(dialog);

  const svg = dialog.querySelector<SVGSVGElement>('svg')!;
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  const focus = (id: string | null) => {
    svg.classList.toggle('is-focused', !!id);
    svg.querySelectorAll<SVGElement>('.graph-link').forEach((line) => line.classList.toggle('is-lit', !!id && (line.dataset.from === id || line.dataset.to === id)));
    svg.querySelectorAll<SVGElement>('.graph-node').forEach((g) => {
      const near = !!id && (g.dataset.id === id || svg.querySelector(`.graph-link.is-lit[data-from="${CSS.escape(g.dataset.id!)}"], .graph-link.is-lit[data-to="${CSS.escape(g.dataset.id!)}"]`) !== null);
      g.classList.toggle('is-lit', near);
    });
  };
  const nodeOf = (event: Event) => (event.target as Element).closest<SVGGElement>('.graph-node');
  svg.addEventListener('mouseover', (event) => focus(nodeOf(event)?.dataset.id ?? null));
  svg.addEventListener('mouseleave', () => focus(null));
  svg.addEventListener('focusin', (event) => focus(nodeOf(event)?.dataset.id ?? null));
  const openNode = (event: MouseEvent | KeyboardEvent) => {
    const id = nodeOf(event)?.dataset.id;
    if (!id) return;
    close();
    options.open(id, event);
  };
  svg.addEventListener('click', openNode);
  svg.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openNode(event); } });
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('mousedown', (event) => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.focus();
}
