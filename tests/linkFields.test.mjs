import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

execFileSync('npx', [
  'tsc',
  'src/linkFields.ts',
  '--target',
  'ES2022',
  '--module',
  'ES2022',
  '--moduleResolution',
  'bundler',
  '--lib',
  'ES2022,DOM',
  '--outDir',
  'dist-test/links',
  '--noEmit',
  'false',
  '--skipLibCheck',
], { stdio: 'inherit' });

// The app is bundled by Vite, so its imports have no extensions; Node needs them.
const built = new URL('../dist-test/links/linkFields.js', import.meta.url);
writeFileSync(built, readFileSync(built, 'utf8').replace(/(from '\.\/[\w/]+)'/g, "$1.js'"));

const { asLinks, linkHint } = await import(built.href);


test('typed names become links; links and blanks stay as they are', () => {
  assert.deepEqual(asLinks({ type: 'text', value: ' Frank Herbert ' }), { value: { type: 'text', value: '[[Frank Herbert]]' }, titles: ['Frank Herbert'] });
  assert.deepEqual(asLinks({ type: 'text', value: '[[Sam Rivera|Sam]]' }), { value: { type: 'text', value: '[[Sam Rivera|Sam]]' }, titles: ['Sam Rivera'] });
  assert.deepEqual(asLinks({ type: 'text', value: '  ' }), { value: { type: 'text', value: '' }, titles: [] });
  assert.deepEqual(asLinks({ type: 'list', value: ['Alex', '[[Kim]]', ''] }), { value: { type: 'list', value: ['[[Alex]]', '[[Kim]]'] }, titles: ['Alex', 'Kim'] });
  assert.deepEqual(asLinks({ type: 'number', value: 3 }), { value: { type: 'number', value: 3 }, titles: [] });
  assert.equal(asLinks({ type: 'text', value: 'a]]b' }).value.value, '[[ab]]', 'brackets can’t break the link');
});

test('empty link fields say what they hold', () => {
  assert.equal(linkHint({ key: 'author', target: 'Person', list: false }), 'A Person');
  assert.equal(linkHint({ key: 'venue', target: 'Event', list: false }), 'An Event');
  assert.equal(linkHint({ key: 'attendees', target: 'Person', list: true }), 'Person notes');
});
