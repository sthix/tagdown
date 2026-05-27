export type DocumentationExample = {
  title: string;
  description: string;
  syntax: string;
};

export type DocumentationSection = {
  id: string;
  title: string;
  summary: string;
  examples: DocumentationExample[];
};

export const tagdownDocumentation: DocumentationSection[] = [
  {
    id: 'basics',
    title: 'Basics',
    summary: 'Tagdown starts with familiar markdown. Use tags only when prose needs more structure.',
    examples: [
      {
        title: 'Headings',
        description: 'Use one to six # characters. Add an optional anchor with {#id}.',
        syntax: '# Main heading\n\n## Section heading {#section}'
      },
      {
        title: 'Paragraphs and rules',
        description: 'Blank lines separate paragraphs. Three or more dashes create a horizontal rule.',
        syntax: 'A paragraph of text.\n\n---\n\nAnother paragraph.'
      },
      {
        title: 'Universal close',
        description: 'Use </> to close the most recent open Tagdown tag when the tag name is obvious.',
        syntax: '<quote "Ada Lovelace">\nThat brain of mine is something more than merely mortal.\n</>'
      }
    ]
  },
  {
    id: 'inline',
    title: 'Inline formatting',
    summary: 'Inline formatting works inside paragraphs, lists, table cells, quotes, and most tag blocks.',
    examples: [
      {
        title: 'Emphasis and code',
        description: 'Use markdown-style emphasis, highlight, strike, and inline code.',
        syntax: '**bold**, *italic*, ==marked==, ~~removed~~, and `inline code`'
      },
      {
        title: 'Links',
        description: 'Use markdown links or paste a bare http/https URL.',
        syntax: '[Tagdown](https://example.com)\n\nhttps://example.com'
      }
    ]
  },
  {
    id: 'blocks',
    title: 'Blocks and lists',
    summary: 'Tagdown supports common block markdown plus explicit tags for richer structures.',
    examples: [
      {
        title: 'Unordered and ordered lists',
        description: 'Every line in the block should use the same list style.',
        syntax: '- one\n- two\n- three\n\n1. first\n2. second'
      },
      {
        title: 'Fenced code',
        description: 'Standard fenced code blocks are supported for simple snippets.',
        syntax: '```js\nconsole.log("hello")\n```'
      },
      {
        title: 'Details',
        description: 'Use details for collapsible extra information.',
        syntax: '<details "Read more">\nHidden explanation here.\n</details>'
      }
    ]
  },
  {
    id: 'callouts',
    title: 'Callouts',
    summary: 'Callouts create labelled note boxes. Supported types: info, warn, warning, error, ok, success, tip.',
    examples: [
      {
        title: 'Shortcut syntax',
        description: 'The ::: shortcut expands to a note tag.',
        syntax: '::: tip Pro tip\nUse callouts for warnings, notes, and side comments.\n:::'
      },
      {
        title: 'Explicit note tag',
        description: 'Use note tags when you want attributes or universal close.',
        syntax: '<note warn "Careful">\nThis changes the rendered output.\n</note>'
      }
    ]
  },
  {
    id: 'tables',
    title: 'Tables and definitions',
    summary: 'Pipe tables are auto-detected. Definition lists are triggered by consecutive term :: description lines.',
    examples: [
      {
        title: 'Pipe table',
        description: 'A separator row is optional and skipped when present.',
        syntax: '| Feature | Syntax |\n| --- | --- |\n| Callout | `::: tip` |\n| Grid | `<grid 2>` |'
      },
      {
        title: 'Definition list',
        description: 'Use at least two consecutive entries to trigger auto-detection.',
        syntax: 'Tagdown :: Markdown plus a small tag layer\nVault :: A local folder of .td files'
      },
      {
        title: 'Explicit defs tag',
        description: 'Use <defs> when you want definition-list parsing in a specific block.',
        syntax: '<defs>\nTerm :: Description\nSecond term :: Another description\n</defs>'
      }
    ]
  },
  {
    id: 'code',
    title: 'Code blocks',
    summary: 'The code tag supports language, filename, line numbers, and highlighted lines.',
    examples: [
      {
        title: 'Code with metadata',
        description: 'Use a bare language name, file=, lines, and hl= ranges.',
        syntax: '<code python file=hello.py lines hl=2-3>\ndef greet(name):\n    print(f"Hello, {name}!")\n    return name.upper()\n</code>'
      },
      {
        title: 'Highlight ranges',
        description: 'Highlight one or more lines with comma-separated line numbers or ranges.',
        syntax: '<code js lines hl=1,3-4>\nconst app = init();\napp.load();\napp.render();\napp.save();\n</code>'
      }
    ]
  },
  {
    id: 'layout',
    title: 'Layout',
    summary: 'Use grids for side-by-side prose. Columns may be written explicitly or split with |||.',
    examples: [
      {
        title: 'Grid shortcut',
        description: 'Inside a grid, ||| splits content into columns.',
        syntax: '<grid 2>\nLeft column content.\n|||\nRight column content.\n</grid>'
      },
      {
        title: 'Explicit columns',
        description: 'Use <col> when each column needs richer nested structure.',
        syntax: '<grid cols=3>\n<col>First</col>\n<col>Second</col>\n<col>Third</col>\n</grid>'
      }
    ]
  },
  {
    id: 'media',
    title: 'Media and quotes',
    summary: 'Figures, quotes, and embeds cover common prose-document needs without heavy rich embeds.',
    examples: [
      {
        title: 'Figure',
        description: 'Use src/caption attributes or positional shorthand.',
        syntax: '<figure src=diagram.png caption="System diagram" />'
      },
      {
        title: 'Quote',
        description: 'Pass a citation as a positional value or by= attribute.',
        syntax: '<quote "Grace Hopper">\nThe most dangerous phrase is: we have always done it this way.\n</quote>'
      },
      {
        title: 'Embed',
        description: 'Embeds render links; YouTube URLs are detected and shown as iframes.',
        syntax: '<embed url=https://youtu.be/dQw4w9WgXcQ />'
      }
    ]
  },
  {
    id: 'limitations',
    title: 'Current limitations',
    summary: 'This reference documents the syntax supported by the parser bundled in this build.',
    examples: [
      {
        title: 'Not a full markdown engine',
        description: 'Nested markdown blocks, task lists, footnotes, math, Mermaid, and complex markdown tables are not implemented yet.',
        syntax: 'Use the supported shortcuts above, or switch to explicit Tagdown tags for structure.'
      },
      {
        title: 'HTML is intentionally limited',
        description: 'Unknown tags are not rendered as arbitrary HTML; only a small safe set passes through.',
        syntax: '<span class="small-note">Allowed simple inline HTML</span>'
      }
    ]
  }
];
