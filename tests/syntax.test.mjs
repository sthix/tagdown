import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSyntax, outputPath } from '../scripts/gen-syntax.mjs';

test('the syntax reference served to AI assistants matches the in-app reference', async () => {
  assert.equal(readFileSync(outputPath, 'utf8'), await renderSyntax(), 'run `npm run gen:syntax`');
});
