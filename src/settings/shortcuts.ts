// The keyboard shortcuts Settings lists. Keep in step with docs/keyboard-shortcuts.md.

export type ShortcutGroup = { title: string; shortcuts: Array<{ keys: string[]; action: string }> };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'App',
    shortcuts: [
      { keys: ['⌘K'], action: 'Command palette' },
      { keys: ['⌘N'], action: 'New note' },
      { keys: ['⌘⇧J'], action: 'Today’s journal page' },
      { keys: ['⌘S'], action: 'Save now' },
      { keys: ['⌘,'], action: 'Settings' },
      { keys: ['⌘\\'], action: 'Focus mode' },
      { keys: ['⌘⇧D'], action: 'Switch light and dark theme' },
    ],
  },
  {
    title: 'Tabs and panes',
    shortcuts: [
      { keys: ['⌘T'], action: 'New tab' },
      { keys: ['⌘W'], action: 'Close tab' },
      { keys: ['⌃⇥', '⌃⇧⇥'], action: 'Next / previous tab' },
      { keys: ['⌘-click'], action: 'Open a note or link in a new tab' },
      { keys: ['⌥⌘-click'], action: 'Open it in a pane beside' },
      { keys: ['⌥⌘\\'], action: 'Split right' },
      { keys: ['⌃⌘←', '⌃⌘→'], action: 'Focus the pane on that side' },
    ],
  },
  {
    title: 'Views',
    shortcuts: [
      { keys: ['⌘1'], action: 'Source' },
      { keys: ['⌘2'], action: 'Split' },
      { keys: ['⌘3'], action: 'Preview' },
    ],
  },
  {
    title: 'Notes',
    shortcuts: [
      { keys: ['⌘⇧T'], action: 'Show every open task' },
      { keys: ['⌘⇧H'], action: 'Version history' },
      { keys: ['⌘⇧E'], action: 'Export as HTML' },
      { keys: ['⌘P'], action: 'Print or save as PDF' },
      { keys: ['⌥⌘P'], action: 'Present as slides' },
      { keys: ['⌥⌘←', '⌥⌘→'], action: 'Previous / next journal day' },
      { keys: ['⌘⇧I'], action: 'Fold or show properties' },
    ],
  },
  {
    title: 'Editing',
    shortcuts: [
      { keys: ['/'], action: 'Command menu' },
      { keys: ['[['], action: 'Link to a note' },
      { keys: ['Esc', '⌘↩'], action: 'Finish editing a block' },
      { keys: ['⌘⇧↑', '⌘⇧↓'], action: 'Move the block up or down' },
    ],
  },
  {
    title: 'Lists',
    shortcuts: [
      { keys: ['↩'], action: 'Next item' },
      { keys: ['⇧↩'], action: 'New line in the same item' },
      { keys: ['Tab'], action: 'Nest the item' },
      { keys: ['⇧Tab'], action: 'Move the item out a level' },
    ],
  },
];
