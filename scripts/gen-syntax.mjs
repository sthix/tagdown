// Writes the Tagdown syntax reference that the CLI and MCP server serve to AI
// assistants, from the same data as the in-app reference
// (src/tagdown/documentation.ts). Run with `npm run gen:syntax`; a test fails
// when the generated file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('..', import.meta.url);
export const outputPath = fileURLToPath(new URL('src-tauri/core/src/syntax.md', root));

export async function renderSyntax() {
  const source = readFileSync(new URL('src/tagdown/documentation.ts', root), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } });
  const { tagdownDocumentation } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const lines = [
    '# Tagdown syntax',
    '',
    'Tagdown is Markdown plus structure: tags, wikilinks, callouts, layout components, math, and diagrams. Plain Markdown is valid Tagdown; reach for the extras when they make a note clearer. A note starts with a `# Title` heading, which is its title; `#tags` anywhere in the text tag it, and `[[Note title]]` links to another note.',
    '',
    '<!-- Generated from src/tagdown/documentation.ts by scripts/gen-syntax.mjs. Do not edit. -->',
  ];
  for (const section of tagdownDocumentation) {
    lines.push('', `## ${section.title}`, '', section.summary);
    for (const example of section.examples) {
      lines.push('', `### ${example.title}`, '', example.description, '', '```tagdown', example.syntax, '```');
    }
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(outputPath, await renderSyntax());
  console.log(`Wrote ${outputPath}`);
}
