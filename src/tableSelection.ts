// Rows ticked in a table view, to set a property on all of them at once.
// Kept per query so a selection outlives the table being repainted after
// each change.

export type TableSelection = {
  ids: Set<string>;
  /** The row last ticked or unticked, where a shift-click range starts. */
  anchor: number | null;
  /** The column the bulk bar sets. */
  column: string | null;
};

const selections = new Map<string, TableSelection>();

/** The selection of the table showing `query`, with rows no longer listed dropped. */
export function selectionFor(query: string, listed: string[]): TableSelection {
  const selection = selections.get(query) ?? { ids: new Set<string>(), anchor: null, column: null };
  const present = new Set(listed);
  for (const id of selection.ids) if (!present.has(id)) selection.ids.delete(id);
  if (selection.anchor !== null && selection.anchor >= listed.length) selection.anchor = null;
  selections.set(query, selection);
  return selection;
}

/**
 * The rows selected after ticking (`on`) or unticking row `index` of `order`.
 * With `shift`, every row from the last one clicked (`anchor`) to this one
 * follows suit.
 */
export function pickRows(order: string[], selected: ReadonlySet<string>, index: number, anchor: number | null, shift: boolean, on: boolean): Set<string> {
  const next = new Set(selected);
  const [from, to] = shift && anchor !== null ? [Math.min(anchor, index), Math.max(anchor, index)] : [index, index];
  for (const id of order.slice(from, to + 1)) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
