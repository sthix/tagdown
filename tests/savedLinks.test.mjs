import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the app's save and navigation flow without booting the desktop UI.
function functionsFrom(path, names) {
  const text = readFileSync(new URL(path, import.meta.url), 'utf8');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return source.statements
    .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map((node) => node.getText(source).replace(/^export /, ''))
    .join('\n');
}

const code = ts.transpileModule([
  functionsFrom('../src/main.ts', ['saveWebLink', 'reloadFolders', 'reloadNotes', 'followWikilink', 'isUserFolder']),
  functionsFrom('../src/wikilinks.ts', ['resolveTarget', 'splitTarget', 'normalizeTitle', 'normalizePath']),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const pasted of [true, false]) {
  test(`saving a web link ${pasted ? 'from a paste' : 'from the dialog'} opens the saved note without creating another`, async () => {
    const saved = { id: 'saved-link', title: 'An article', folderId: null, path: 'note-saved-link.md' };
    const diskNotes = [];
    const opened = [];
    let inserted;
    let created = 0;
    const context = vm.createContext({
      selectedFolder: null, selectedTag: null, selectedType: null,
      selectedNote: null, sort: 'updatedDesc', libraryNotes: [], notes: [],
      folders: [], allNotesCount: 0, knownNotes: new Map(),
      async invoke(command) {
        if (command === 'save_web_link') {
          diskNotes.push(saved);
          return { note: saved, existed: false, fetchError: null };
        }
        if (command === 'list_notes') return [...diskNotes];
        if (command === 'list_folders') return [];
        throw new Error(`Unexpected command: ${command}`);
      },
      async createNoteTitled(title) {
        created++;
        const empty = { id: 'empty-duplicate', title, folderId: null };
        diskNotes.push(empty);
        return empty;
      },
      async revealNote(id) { opened.push(id); },
      replacePastedLink(_textarea, _url, text) { inserted = text; },
      reloadTypes() {}, closeMissingTabs() {}, renderFolders() {},
      renderNotes() {}, invalidateQueries() {}, showNotice() {},
      isDayKey() { return false; },
    });
    vm.runInContext(code, context);
    await context.saveWebLink('https://example.com/article', pasted ? {} : undefined);
    if (pasted) {
      assert.equal(inserted, '[[An article]]');
      await context.followWikilink('An article');
    }
    assert.deepEqual(opened, [saved.id], 'navigation opens the note containing the fetched article');
    assert.equal(created, 0, 'the saved note is already available to link resolution');
    assert.equal(diskNotes.length, 1);
    assert.equal(context.libraryNotes[0].id, saved.id);
    assert.equal(context.allNotesCount, 1);
  });
}
