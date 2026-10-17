// A small right-click menu, styled like the export menu. One is open at a time;
// a click elsewhere, Escape, scrolling or leaving the window closes it.

export type MenuItem =
  | { label: string; icon?: string; shortcut?: string; danger?: boolean; disabled?: boolean; run: () => void | Promise<void> }
  | 'separator';

let open: { el: HTMLElement; close: () => void } | null = null;

export function closeContextMenu() {
  open?.close();
}

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item === 'separator') {
      if (menu.lastElementChild && !menu.lastElementChild.matches('hr')) menu.append(document.createElement('hr'));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.disabled = !!item.disabled;
    if (item.danger) button.classList.add('is-danger');
    button.innerHTML = `${item.icon ?? '<span class="context-menu-gap" aria-hidden="true"></span>'}<span></span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}`;
    button.querySelector('span:not(.context-menu-gap)')!.textContent = item.label;
    button.addEventListener('click', () => {
      close();
      void item.run();
    });
    menu.append(button);
  }
  if (menu.lastElementChild?.matches('hr')) menu.lastElementChild.remove();
  document.body.append(menu);

  // Keep it on screen.
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - width - 6))}px`;
  menu.style.top = `${Math.max(6, y + height > window.innerHeight - 6 ? y - height : y)}px`;

  const onPointer = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
  const onKey = (event: KeyboardEvent) => {
    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); }
  };
  function close() {
    if (open?.el !== menu) return;
    open = null;
    menu.remove();
    document.removeEventListener('mousedown', onPointer, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('wheel', close, true);
  }
  document.addEventListener('mousedown', onPointer, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', close);
  window.addEventListener('wheel', close, true);
  open = { el: menu, close };
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}
