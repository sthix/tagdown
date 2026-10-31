import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

await build({ entryPoints: ['src/noteExcerpt.ts'], outfile: 'dist-test/note-excerpt.mjs', bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { noteExcerpt, noteExcerptRanges } = await import(new URL('../dist-test/note-excerpt.mjs', import.meta.url).href);

test('excerpts drop block syntax and partial links but keep prose', () => {
  assert.equal(noteExcerpt('Some text #crdt ::: q What is a CRDT? :::'), 'Some text #crdt What is a CRDT?');
  assert.equal(noteExcerpt('> [!note] Decision > Sync stays opt-in'), 'Decision Sync stays opt-in');
  assert.equal(noteExcerpt('ee with [[Mira Lang]] about [[Atl'), 'ee with Mira Lang about Atl');
  assert.equal(noteExcerpt('See <query tag:x /> and <keys>Cmd+K</keys> %%secret%% now'), 'See and Cmd+K now');
  assert.equal(noteExcerpt('```rust fn a() ``` *soft* ==mark== ^ab12'), 'fn a() soft mark');
  assert.equal(noteExcerpt('Use Vec<String> and 2 * 3 here'), 'Use Vec<String> and 2 * 3 here');
});

test('matched ranges follow their words through excerpt cleanup', () => {
  const source = '# Plan We ship **Atlas** with [[Atlas launch]]';
  const { text, ranges } = noteExcerptRanges(source, [[17, 22], [32, 37]]);
  assert.equal(text, 'Plan We ship Atlas with Atlas launch');
  assert.deepEqual(ranges.map(([a, b]) => text.slice(a, b)), ['Atlas', 'Atlas']);
});
