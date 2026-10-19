type HierarchyType = { name: string; parent?: string | null; ancestors?: string[] };
const key = (name: string) => name.trim().toLowerCase();

/** Parent views and link fields also accept their child types. */
export function typeMatches(type: HierarchyType | undefined, name: string, wanted: string): boolean {
  return key(name) === key(wanted) || !!type?.ancestors?.some((ancestor) => key(ancestor) === key(wanted));
}

/** A stable tree order that still shows orphaned or cyclic types once each. */
export function typeTree<T extends HierarchyType>(types: T[]): Array<{ type: T; depth: number }> {
  const names = new Set(types.map((t) => key(t.name)));
  const sorted = [...types].sort((a, b) => a.name.localeCompare(b.name));
  const children = new Map<string, T[]>();
  for (const type of sorted) {
    const parent = type.parent && names.has(key(type.parent)) ? key(type.parent) : '';
    children.set(parent, [...(children.get(parent) ?? []), type]);
  }
  const rows: Array<{ type: T; depth: number }> = [];
  const seen = new Set<string>();
  const visit = (type: T, depth: number) => {
    if (seen.has(key(type.name))) return;
    seen.add(key(type.name));
    rows.push({ type, depth });
    for (const child of children.get(key(type.name)) ?? []) visit(child, depth + 1);
  };
  for (const type of children.get('') ?? []) visit(type, 0);
  for (const type of sorted) visit(type, 0);
  return rows;
}
