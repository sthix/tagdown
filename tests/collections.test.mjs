import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', ['tsc', 'src/collectionModel.ts', '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler', '--outDir', 'dist-test/collections', '--skipLibCheck'], { stdio: 'inherit' });
const path = new URL('../dist-test/collections/collectionModel.js', import.meta.url);
writeFileSync(path, readFileSync(path, 'utf8').replace("from './queryText'", "from './queryText.js'"));
const { collectionScope, collectionLayout, collectionQuery, collectionFilters } = await import(path.href);

test('saved scopes preserve folder, type, tag and quick filters', () => {
  const scope = { folder: null, tag: null, type: null, filter: 'all' };
  assert.equal(collectionScope(scope), 'sort:updated limit:500');
  assert.match(collectionScope({ ...scope, folder: 'Research notes', filter: 'pinned' }), /folder:"Research notes" is:pinned$/);
  assert.match(collectionScope({ ...scope, tag: 'project/active', type: 'Research Book' }), /tag:project\/active type:"Research Book"$/);
  assert.match(collectionScope({ ...scope, folder: 'journal', filter: 'untagged' }), /is:journal is:untagged$/);
  assert.equal(collectionScope({ ...scope, filter: 'recent' }), 'sort:updated limit:10');
  assert.match(collectionScope({ ...scope, folder: 'archive' }), /folder:archive$/);
});

test('layout changes retain rules, ordering and explicit columns', () => {
  const rules = 'type:Book owner=[[Sam Rivera]] sort:-due columns:status,due show:table';
  const next = collectionQuery(rules, 'cards');
  assert.equal(next, 'type:Book owner=[[Sam Rivera]] sort:-due columns:status,due show:cards');
  assert.equal(collectionLayout(next), 'cards');
  assert.equal(collectionLayout('type:Book'), 'notes');
  assert.equal(collectionQuery('show:cards show:table tag:project', 'board'), 'show:board tag:project');
});

test('scope labels keep actual filters and omit presentation options', () => {
  assert.deepEqual(collectionFilters('tag:project type:"Research Book" is:pinned show:cards sort:updated columns:status limit:50'), ['#project', 'Research Book', 'Pinned']);
  assert.deepEqual(collectionFilters('"two words" -tag:archive status=active'), ['two words', 'Without #archive', 'status=active']);
  assert.deepEqual(collectionFilters('show:table columns:status sort:title'), []);
});
test('scope labels read negations and folders the way the sidebar names them', () => {
 const names = (id) => id === 'f-123' ? 'Research' : null;
 assert.deepEqual(collectionFilters('-is:pinned -is:thought is:Unlinked -type:Book', names), ['Not pinned', 'Reviewed', 'Unlinked', 'Not Book']);
 assert.deepEqual(collectionFilters('folder:f-123 folder:archive folder:"Old stuff"', names), ['In Research', 'Archive', 'In Old stuff']);
 assert.deepEqual(collectionFilters('is:someday'), ['is:someday']);
});
