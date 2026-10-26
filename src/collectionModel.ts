import { getOption, queryTokens, setOption } from './queryText';

export type Collection = { id: string; name: string; icon: string; query: string };
export const THOUGHTS_COLLECTION: Collection = { id: 'builtin:thoughts', name: 'Thoughts', icon: '💭', query: 'is:thought show:cards sort:updated limit:500' };
export const isThoughtsCollection = (collection: Collection | null) => collection?.id === THOUGHTS_COLLECTION.id;
export type CollectionLayout = 'notes' | 'table' | 'cards' | 'board' | 'tasks';
export const COLLECTION_LAYOUTS: Array<{ value: CollectionLayout; label: string }> = [
  { value: 'notes', label: 'List' }, { value: 'table', label: 'Table' },
  { value: 'cards', label: 'Cards' }, { value: 'board', label: 'Board' }, { value: 'tasks', label: 'Tasks' },
];

export function collectionLayout(query: string): CollectionLayout {
  const value = getOption(query, 'show');
  return COLLECTION_LAYOUTS.find((layout) => layout.value === value)?.value ?? 'notes';
}

export function collectionQuery(rules: string, layout: CollectionLayout) {
  return setOption(rules, 'show', layout);
}

const NOTE_FILTERS: Record<string, [string, string]> = {
  pinned: ['Pinned', 'Not pinned'], untagged: ['Untagged', 'Tagged'], journal: ['Journal', 'Not journal'],
  thought: ['Needs review', 'Reviewed'], empty: ['Needs content', 'Has content'], unlinked: ['Unlinked', 'Linked'],
};

/**
 * Short, readable scope labels, with presentation options left to the view controls.
 * `folderName` turns a saved folder id into the name the sidebar shows.
 */
export function collectionFilters(query: string, folderName: (value: string) => string | null = () => null) {
  return queryTokens(query).flatMap((token) => {
    const colon = token.indexOf(':');
    const key = colon < 0 ? '' : token.slice(0, colon).toLowerCase();
    const value = token.slice(colon + 1).replace(/^"(.*)"$/, '$1');
    if (['show', 'sort', 'limit', 'columns', 'group', 'lanes'].includes(key)) return [];
    if (key === 'tag') return [`#${value}`];
    if (key === '-tag') return [`Without #${value}`];
    if (key === 'type') return [value];
    if (key === '-type') return [`Not ${value}`];
    if (key === 'folder') return [value.toLowerCase() === 'archive' ? 'Archive' : `In ${folderName(value) ?? value}`];
    if (key === 'is' || key === '-is') {
      const labels = NOTE_FILTERS[value.toLowerCase()];
      return [labels ? labels[key === 'is' ? 0 : 1] : token];
    }
    return [token.replace(/^"(.*)"$/, '$1')];
  });
}

/** A saved query equivalent to the list the user is browsing. */
export function collectionScope(scope: { folder: string | null; tag: string | null; type: string | null; filter: string }) {
  let query = 'sort:updated limit:500';
  if (scope.folder === 'journal') query += ' is:journal';
  else if (scope.folder) query = setOption(query, 'folder', scope.folder);
  if (scope.tag) query = setOption(query, 'tag', scope.tag);
  if (scope.type) query = setOption(query, 'type', scope.type);
  if (scope.filter === 'pinned') query += ' is:pinned';
  if (scope.filter === 'untagged') query += ' is:untagged';
  if (scope.filter === 'recent') query = setOption(query, 'limit', '10');
  return query;
}
