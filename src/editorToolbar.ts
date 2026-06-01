export type ModuleCategory = 'Layout' | 'Blocks' | 'Media' | 'Code & Math' | 'Text' | 'References';

export type ToolbarModule = {
  label: string;
  description: string;
  category: ModuleCategory;
  template: string;
};

type ToolbarAction = {
  label: string;
  title: string;
  insert?: string;
  wrap?: string;
  line?: boolean;
  description?: string;
  className?: string;
};

type ToolbarGroup = {
  label: string;
  actions: ToolbarAction[];
};

export const MODULES: ToolbarModule[] = [
  { label: 'Task list',         description: 'Checklist with toggleable items', category: 'Blocks',      template: '\n- [ ] First task\n- [x] Done task\n- [ ] Another task\n' },
  { label: 'Numbered list',     description: 'Ordered list',                    category: 'Blocks',      template: '\n1. First item\n2. Second item\n3. Third item\n' },
  { label: 'Code block',        description: 'Fenced code with language',       category: 'Code & Math', template: '\n<code js>\n// code here\n</code>\n' },
  { label: 'Details',           description: 'Collapsible disclosure',          category: 'Blocks',      template: '\n<details "Summary">\nHidden content\n</details>\n' },
  { label: 'Grid',              description: 'Multi-column layout',             category: 'Layout',      template: '\n<grid 2>\nLeft column\n|||\nRight column\n</grid>\n' },
  { label: 'Quote',             description: 'Block quotation with citation',   category: 'Text',        template: '\n<quote "Author">\nQuotation text\n</quote>\n' },
  { label: 'Figure',            description: 'Image with caption',              category: 'Media',       template: '\n<figure src=image.png caption="Caption" />\n' },
  { label: 'Embed',             description: 'External URL (YouTube, Vimeo)',   category: 'Media',       template: '\n<embed url=https://youtu.be/... />\n' },
  { label: 'Tabs',              description: 'Switchable tab panels',           category: 'Layout',      template: '\n<tabs>\n<tab "First">\nFirst panel\n</tab>\n<tab "Second">\nSecond panel\n</tab>\n</tabs>\n' },
  { label: 'Aside',             description: 'Pull-quote / sidenote',           category: 'Layout',      template: '\n<aside right>\nSidenote text\n</aside>\n' },
  { label: 'Keys',              description: 'Keyboard shortcut group',         category: 'Text',        template: '<keys>Cmd+K</keys>' },
  { label: 'Center',            description: 'Center-aligned block',            category: 'Layout',      template: '\n<center>\nCentered content\n</center>\n' },
  { label: 'Mermaid',           description: 'Diagram in mermaid syntax',       category: 'Code & Math', template: '\n```mermaid\ngraph LR\n  A --> B --> C\n```\n' },
  { label: 'Math block',        description: 'KaTeX block formula',             category: 'Code & Math', template: '\n$$\nE = mc^2\n$$\n' },
  { label: 'Definition list',   description: 'Term :: Definition pairs',        category: 'References',  template: '\nHTML :: HyperText Markup Language\nCSS :: Cascading Style Sheets\n' },
  { label: 'Wikilink',          description: 'Cross-note link [[Name]]',        category: 'References',  template: '[[Note Name]]' },
  { label: 'Horizontal rule',   description: 'Section divider',                 category: 'Blocks',      template: '\n---\n' },
  { label: 'Table of contents', description: 'Auto-generated headings list',    category: 'References',  template: '\n<toc />\n' },
  { label: 'Frontmatter',       description: 'YAML metadata header',            category: 'References',  template: '---\ntitle: \ndate: \n---\n' },
  { label: 'Highlight',         description: 'Marked / highlighted text',       category: 'Text',        template: '==highlighted==' },
  { label: 'Strikethrough',     description: 'Crossed-out text',                category: 'Text',        template: '~~text~~' },
  { label: 'Inline math',       description: 'KaTeX inline formula',            category: 'Code & Math', template: '$x^2$' },
  { label: 'Footnote',          description: 'Footnote reference [^id]',        category: 'References',  template: '[^1]' },
];

const TOOLBAR_GROUPS: ToolbarGroup[] = [
  {
    label: 'Write',
    actions: [
      { label: 'H', title: 'Heading', insert: '# ', line: true, className: 'is-strong' },
      { label: 'B', title: 'Bold', wrap: '**|**', className: 'is-strong' },
      { label: '<i>I</i>', title: 'Italic', wrap: '*|*' },
      { label: '&lt;/&gt;', title: 'Inline code', wrap: '`|`', className: 'is-code' },
    ],
  },
];

const COMPONENT_ACTION_GROUPS: ToolbarGroup[] = [
  {
    label: 'Structure',
    actions: [
      { label: 'Bullet list', title: 'Bullet list', description: 'Start an unordered list', insert: '- ', line: true },
      { label: 'Table', title: 'Table', description: 'Pipe table with header and one row', insert: '\n| Header | Header |\n| ------ | ------ |\n| Cell | Cell |\n' },
      { label: 'Callout', title: 'Callout', description: 'Info callout block', insert: '\n::: info\nYour message here\n:::\n' },
    ],
  },
  {
    label: 'Tagdown',
    actions: [
      { label: 'Tagdown pair', title: 'Tagdown pair', description: 'Single key :: value pair', insert: 'key :: value', className: 'is-accent is-code' },
      { label: 'Keyboard key', title: 'Keyboard key', description: 'Wrap the current selection in <kbd>', wrap: '<kbd>|</kbd>', className: 'is-code' },
    ],
  },
];

const CATEGORY_ORDER: ModuleCategory[] = ['Layout', 'Blocks', 'Media', 'Code & Math', 'Text', 'References'];

export function renderEditorToolbar(modules: readonly ToolbarModule[] = MODULES): string {
  const groups = TOOLBAR_GROUPS.map(renderToolbarGroup).join('');
  const actionSections = COMPONENT_ACTION_GROUPS.map(renderMenuActionSection).join('');
  const moduleSections = CATEGORY_ORDER.map((category) => renderModuleSection(category, modules)).join('');

  return `
    <div class="format-toolbar" aria-label="Formatting toolbar">
      <div class="toolbar-quick-actions" role="group" aria-label="Quick formatting actions">
        ${groups}
      </div>
      <div class="toolbar-dropdown">
        <button type="button" id="insert-module" class="toolbar-dropdown-trigger"
                aria-haspopup="menu" aria-expanded="false" title="Insert component">
          <strong>Components</strong>
          <span aria-hidden="true">▾</span>
        </button>
        <div class="toolbar-menu" role="menu" hidden>
          <div class="toolbar-menu-heading">
            <strong>Tagdown components</strong>
            <span>Structure, tagdown, layout, media, math, references</span>
          </div>
          ${actionSections}${moduleSections}
        </div>
      </div>
    </div>`;
}

function renderToolbarGroup(group: ToolbarGroup): string {
  return `
    <section class="toolbar-group" aria-label="${escapeHtml(group.label)}">
      <span class="toolbar-group-label">${escapeHtml(group.label)}</span>
      <div class="toolbar-group-actions">
        ${group.actions.map(renderToolbarAction).join('')}
      </div>
    </section>`;
}

function renderToolbarAction(action: ToolbarAction): string {
  const dataset = action.wrap
    ? `data-wrap="${escapeHtml(action.wrap)}"`
    : `data-insert="${escapeHtml(action.insert ?? '')}"${action.line ? ' data-line="true"' : ''}`;
  const className = action.className ? ` class="${escapeHtml(action.className)}"` : '';

  return `<button type="button"${className} ${dataset} title="${escapeHtml(action.title)}">${action.label}</button>`;
}

function renderMenuActionSection(group: ToolbarGroup): string {
  return `
    <section class="toolbar-menu-section" aria-label="${escapeHtml(group.label)}">
      <h3>${escapeHtml(group.label)}</h3>
      <div class="toolbar-menu-items">
        ${group.actions.map(renderMenuActionItem).join('')}
      </div>
    </section>`;
}

function renderMenuActionItem(action: ToolbarAction): string {
  const dataset = action.wrap
    ? `data-wrap="${escapeHtml(action.wrap)}"`
    : `data-insert="${escapeHtml(action.insert ?? '')}"${action.line ? ' data-line="true"' : ''}`;
  const description = action.description ?? action.title;

  return `
    <button type="button" role="menuitem" tabindex="-1" ${dataset} title="${escapeHtml(action.title)}">
      <strong>${escapeHtml(action.label)}</strong>
      <small>${escapeHtml(description)}</small>
    </button>`;
}

function renderModuleSection(category: ModuleCategory, modules: readonly ToolbarModule[]): string {
  const items = modules.filter((module) => module.category === category);
  if (!items.length) return '';

  return `
    <section class="toolbar-menu-section" aria-label="${escapeHtml(category)}">
      <h3>${escapeHtml(category)}</h3>
      <div class="toolbar-menu-items">
        ${items.map(renderModuleItem).join('')}
      </div>
    </section>`;
}

function renderModuleItem(module: ToolbarModule): string {
  return `
    <button type="button" role="menuitem" tabindex="-1" data-insert="${escapeHtml(module.template)}" title="${escapeHtml(module.description)}">
      <strong>${escapeHtml(module.label)}</strong>
      <small>${escapeHtml(module.description)}</small>
    </button>`;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
