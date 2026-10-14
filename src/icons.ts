// The app's line icons: 16×16 strokes drawn in the current text colour.

export const UI_ICONS: Record<string, string> = {
  search: '<circle cx="7.2" cy="7.2" r="4.4" /><path d="M10.5 10.5l3 3" />',
  compose: '<path d="M8.5 3H4.2c-.7 0-1.2.5-1.2 1.2v7.6c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V7.5" /><path d="M11.6 2.6l1.8 1.8-5.2 5.2-2.3.5.5-2.3 5.2-5.2z" />',
  plus: '<path d="M8 3.5v9M3.5 8h9" />',
  sliders: '<path d="M2.5 4.5h4.2M10.3 4.5h3.2M2.5 11.5h1.7M7.8 11.5h5.7" /><circle cx="8.5" cy="4.5" r="1.8" /><circle cx="6" cy="11.5" r="1.8" />',
  pin: '<path d="M9.8 2.5l3.7 3.7-1.6.6-2.3 2.3-.3 2.6-1 1-4-4 1-1 2.6-.3 2.3-2.3z" /><path d="M5 11l-2.5 2.5" />',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />',
  trash: '<path d="M3 4.5h10M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M4.3 4.5l.6 8.2c0 .5.5.8.9.8h4.4c.5 0 .9-.4.9-.8l.6-8.2" />',
  hash: '<path d="M6.3 2.5L5 13.5M11 2.5L9.7 13.5M3 6h10.5M2.5 10H13" />',
  chevronDown: '<path d="M4.5 6.3L8 9.8l3.5-3.5" />',
  focus: '<path d="M2.8 6V3.6c0-.4.4-.8.8-.8H6M10 2.8h2.4c.4 0 .8.4.8.8V6M13.2 10v2.4c0 .4-.4.8-.8.8H10M6 13.2H3.6c-.4 0-.8-.4-.8-.8V10" />',
  expand: '<path d="M9.5 2.8h3.7v3.7M13.2 2.8L9 7M6.5 13.2H2.8V9.5M2.8 13.2L7 9" />',
  collapse: '<path d="M12.8 7H9V3.2M9 7l4.2-4.2M3.2 9H7v3.8M7 9l-4.2 4.2" />',
  sidebar: '<rect x="2.5" y="3" width="11" height="10" rx="1.6" /><path d="M6.3 3v10" />',
  moon: '<path d="M12.8 9.6A5.2 5.2 0 016.4 3.2a5.2 5.2 0 106.4 6.4z" />',
  sun: '<circle cx="8" cy="8" r="2.6" /><path d="M8 1.8v1.4M8 12.8v1.4M3.6 3.6l1 1M11.4 11.4l1 1M1.8 8h1.4M12.8 8h1.4M3.6 12.4l1-1M11.4 4.6l1-1" />',
  book: '<path d="M3.4 3.2h4c.7 0 1.3.6 1.3 1.3v8.3c-.3-.5-.8-.8-1.5-.8H3.4V3.2z" /><path d="M8.7 4.5c0-.7.6-1.3 1.3-1.3h2.6V12H10c-.6 0-1.1.3-1.3.8" />',
  source: '<path d="M5.5 4.5L2.5 8l3 3.5M10.5 4.5l3 3.5-3 3.5" />',
  split: '<rect x="2.5" y="3" width="11" height="10" rx="1.6" /><path d="M8 3v10" />',
  eye: '<path d="M1.8 8s2.3-4.3 6.2-4.3S14.2 8 14.2 8s-2.3 4.3-6.2 4.3S1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.9" />',
  share: '<path d="M8 2.5v7.5M5.2 5.2L8 2.5l2.8 2.7" /><path d="M5 7.5H4.2c-.7 0-1.2.5-1.2 1.2v3.6c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V8.7c0-.7-.5-1.2-1.2-1.2H11" />',
  globe: '<circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.5 1.6 2.2 3.4 2.2 5.5S9.5 11.9 8 13.5C6.5 11.9 5.8 10.1 5.8 8S6.5 4.1 8 2.5z" />',
  checklist: '<path d="M2.8 4.2l1.1 1.1 2-2.2M2.8 9.7l1.1 1.1 2-2.2" /><path d="M8 4.3h5.2M8 9.8h5.2" />',
  play: '<path d="M5 3.4v9.2c0 .5.5.8.9.5l7-4.6c.4-.3.4-.8 0-1.1l-7-4.6c-.4-.2-.9 0-.9.6z" />',
  clock: '<circle cx="8" cy="8" r="5.6" /><path d="M8 4.8V8l2.2 1.4" />',
  printer: '<path d="M4.5 6V2.8h7V6" /><rect x="2.5" y="6" width="11" height="5" rx="1.1" /><path d="M4.5 9.5h7v3.7h-7z" />',
  calendar: '<rect x="3" y="3.8" width="10" height="9" rx="1.1" /><path d="M5.5 2.5v2.2M10.5 2.5v2.2M3.3 6.4h9.4" />',
  chevronLeft: '<path d="M10 3.5L5.5 8l4.5 4.5" />',
  chevronRight: '<path d="M6 3.5L10.5 8 6 12.5" />',
  keyboard: '<rect x="1.8" y="4" width="12.4" height="8" rx="1.4" /><path d="M4.4 6.6h.1M6.8 6.6h.1M9.2 6.6h.1M11.6 6.6h.1M4.4 9.4h.1M11.6 9.4h.1M6.6 9.4h2.8" />',
  type: '<path d="M3.5 4.5V3h9v1.5M8 3v10M6.2 13h3.6" />',
  folder: '<path d="M2.5 4.8c0-.8.6-1.4 1.4-1.4h2.2c.3 0 .6.1.8.3l1 1c.2.2.5.3.8.3h3.4c.8 0 1.4.6 1.4 1.4v5.2c0 .8-.6 1.4-1.4 1.4H3.9c-.8 0-1.4-.6-1.4-1.4V4.8z" />',
};

export function uiIcon(key: keyof typeof UI_ICONS, size = 14) {
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI_ICONS[key]}</svg>`;
}
