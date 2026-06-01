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
        description: 'One to six # characters. Every heading gets an auto-slug id; add an explicit anchor with {#id}.',
        syntax: '# Main heading\n\n## Section heading {#section}\n\n[jump](#section)'
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
      },
      {
        title: 'Table of contents',
        description: 'A <toc /> tag becomes a clickable list of every heading in the document.',
        syntax: '<toc />\n\n# Intro\n## Setup\n## Usage'
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
        description: 'Use markdown links, paste a bare http/https URL, or wrap an email in angle brackets.',
        syntax: '[Tagdown](https://example.com)\n\nhttps://example.com\n\n<hi@example.com>'
      },
      {
        title: 'Subscript and superscript',
        description: 'Use ~x~ for subscript and ^x^ for superscript. Inside, no whitespace.',
        syntax: 'Water is H~2~O and Einstein wrote E = mc^2^.'
      },
      {
        title: 'Wikilinks',
        description: 'Reference another note with [[Title]] or [[Title|display label]].',
        syntax: 'See [[Welcome]] or [[Welcome|the intro]].'
      },
      {
        title: 'Smart typography',
        description: 'Straight quotes curl, -- becomes en-dash, --- becomes em-dash, ... becomes ellipsis.',
        syntax: '"Hello" --- this is a test... 1990--2020.'
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
        title: 'Task lists',
        description: 'Mix - [x] and - [ ] entries inside a normal bullet list.',
        syntax: '- [x] Done item\n- [ ] Pending item\n- Regular bullet'
      },
      {
        title: 'Fenced code',
        description: 'Standard fenced code blocks are supported for simple snippets.',
        syntax: '```js\nconsole.log("hello")\n```'
      },
      {
        title: 'Footnote definition',
        description: 'Reference with [^id]; define anywhere with [^id]: text. Definitions are collected into a bibliography at the bottom.',
        syntax: 'Tagdown is small[^1].\n\n[^1]: The parser fits in one file.'
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
    summary: 'Callouts create labelled note boxes. Types: info, warn, error, ok, tip. GitHub-style aliases also work.',
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
      },
      {
        title: 'GitHub-style aliases',
        description: 'note maps to info, warning/caution to warn, important to tip, danger to error.',
        syntax: '::: warning Heads up\nAlias for ::: warn.\n:::'
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
        description: 'YouTube and Vimeo URLs render as a click-to-play thumbnail that opens the video in your browser; other URLs render as links.',
        syntax: '<embed url=https://youtu.be/dQw4w9WgXcQ />'
      }
    ]
  },
  {
    id: 'advanced',
    title: 'Advanced',
    summary: 'Power features for technical writing: math, diagrams, tabs, asides, keys, and more.',
    examples: [
      {
        title: 'Math (KaTeX)',
        description: 'Inline $a^2 + b^2$ or block $$E = mc^2$$. Rendered with KaTeX.',
        syntax: 'Inline math like $E = mc^2$ or:\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$'
      },
      {
        title: 'Mermaid diagrams',
        description: 'A fenced code block tagged ```mermaid is rendered as an SVG diagram.',
        syntax: '```mermaid\ngraph LR\n  A[Source] --> B[Tokenize]\n  B --> C[Parse]\n  C --> D[Render]\n```'
      },
      {
        title: 'Tabs',
        description: 'Group content into switchable tabs. Pure CSS, no JS needed at render time.',
        syntax: '<tabs>\n<tab "Source">\nSource view\n</tab>\n<tab "Preview">\nPreview view\n</tab>\n</tabs>'
      },
      {
        title: 'Aside / sidenote',
        description: 'A pull-quote that floats to the side on wider screens, becomes a block below 720px.',
        syntax: '<aside right>\nA tangential thought that sits beside the main text.\n</aside>\n\nMain body wraps around the aside.'
      },
      {
        title: 'Keyboard shortcut group',
        description: 'Auto-wraps each key in <kbd>; uses + and spaces as separators.',
        syntax: 'Press <keys>Cmd+K</keys> to search.'
      },
      {
        title: 'Centered block',
        description: 'A centered container — handy for figure-like headers or marquee callouts.',
        syntax: '<center>\n*Featured chapter*\n</center>'
      }
    ]
  }
];
