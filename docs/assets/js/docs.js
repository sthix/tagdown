(() => {
  const root = document.documentElement;
  const themeButton = document.querySelector('.theme-toggle');
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  const darkPictures = [...document.querySelectorAll('picture source[media="(prefers-color-scheme: dark)"]')];
  const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : systemTheme.matches;
  const updateThemeLabel = () => {
    themeButton.setAttribute('aria-label', `Switch to ${isDark() ? 'light' : 'dark'} theme`);
    darkPictures.forEach(source => { source.media = isDark() ? 'all' : 'not all'; });
  };
  updateThemeLabel();
  systemTheme.addEventListener('change', updateThemeLabel);
  themeButton.addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    try { localStorage.setItem('tagdown-docs-theme', root.dataset.theme); } catch (_) {}
    updateThemeLabel();
  });

  const menu = document.querySelector('.menu-toggle');
  const sidebar = document.querySelector('.site-sidebar');
  const backdrop = document.querySelector('.nav-backdrop');
  const setMenu = (open, restoreFocus = false) => {
    sidebar.classList.toggle('is-open', open);
    document.body.classList.toggle('nav-open', open);
    backdrop.hidden = !open;
    document.querySelector('.page-shell').inert = open;
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    if (restoreFocus) menu.focus();
  };
  menu.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  backdrop.addEventListener('click', () => setMenu(false, true));
  sidebar.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') setMenu(false, true);
    if (event.key === 'Tab' && menu.getAttribute('aria-expanded') === 'true') {
      const controls = [...document.querySelectorAll('.site-header a, .site-header button, .site-sidebar a')].filter(element => element.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  matchMedia('(max-width: 760px)').addEventListener('change', () => setMenu(false));

  const article = document.querySelector('.article');
  article.querySelectorAll('table').forEach(table => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper);
    wrapper.append(table);
  });

  const outline = document.querySelector('.page-outline');
  const headings = [...article.querySelectorAll('h2[id], h3[id], h4[id]')];
  const outlineLinks = new Map();
  headings.forEach(heading => {
    const title = heading.textContent;
    const anchor = document.createElement('a');
    anchor.className = 'heading-link';
    anchor.href = `#${heading.id}`;
    anchor.textContent = '#';
    anchor.setAttribute('aria-label', `Link to ${title}`);
    heading.prepend(anchor);
    if (heading.tagName !== 'H2') return;
    const link = document.createElement('a');
    link.href = anchor.href;
    link.textContent = title;
    outline.querySelector('nav').append(link);
    outlineLinks.set(heading, link);
  });
  outline.hidden = outlineLinks.size === 0;
  if (outlineLinks.size && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.find(entry => entry.isIntersecting);
      if (!visible) return;
      outlineLinks.forEach(link => link.removeAttribute('aria-current'));
      outlineLinks.get(visible.target).setAttribute('aria-current', 'location');
    }, { rootMargin: '-80px 0px -65% 0px' });
    outlineLinks.forEach((_, heading) => observer.observe(heading));
  }

  const dialog = document.querySelector('.search-dialog');
  const input = dialog.querySelector('input');
  const status = dialog.querySelector('.search-status');
  const results = dialog.querySelector('.search-results');
  let indexPromise;
  let request = 0;
  const loadIndex = () => {
    if (!indexPromise) {
      indexPromise = fetch(dialog.dataset.index).then(response => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      }).catch(error => { indexPromise = undefined; throw error; });
    }
    return indexPromise;
  };
  const search = async () => {
    const currentRequest = ++request;
    const query = input.value.trim().toLocaleLowerCase();
    results.replaceChildren();
    if (!query) { status.textContent = 'Type to search all guides.'; return; }
    status.textContent = 'Searching…';
    try {
      const pages = await loadIndex();
      if (currentRequest !== request) return;
      const words = query.split(/\s+/);
      const matches = pages.map(page => {
        const title = page.title.toLocaleLowerCase();
        const body = page.content.toLocaleLowerCase();
        const matchesAll = words.every(word => title.includes(word) || body.includes(word));
        const score = (title.includes(query) ? 10 : 0) + words.filter(word => title.includes(word)).length;
        return { ...page, score, matchesAll };
      }).filter(page => page.matchesAll).sort((a, b) => b.score - a.score).slice(0, 12);
      status.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? 'guide' : 'guides'} found.` : 'No guides found. Try a different word, like “journal” or “links”.';
      matches.forEach(page => {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = page.url;
        const title = document.createElement('strong');
        title.textContent = page.title;
        const excerpt = document.createElement('p');
        const at = page.content.toLocaleLowerCase().indexOf(words[0]);
        const start = Math.max(0, at - 45);
        excerpt.textContent = `${start ? '…' : ''}${page.content.slice(start, start + 180)}${page.content.length > start + 180 ? '…' : ''}`;
        link.append(title, excerpt);
        li.append(link);
        results.append(li);
      });
    } catch (_) {
      if (currentRequest === request) status.textContent = 'Search could not load. Try again, or choose a guide from the sidebar.';
    }
  };
  const openSearch = () => {
    setMenu(false);
    if (!dialog.open) dialog.showModal();
    input.focus();
    search();
  };
  document.querySelector('.search-toggle').addEventListener('click', openSearch);
  dialog.querySelector('.search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  input.addEventListener('input', search);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('a')?.focus(); }
    if (event.key === 'Enter') results.querySelector('a')?.click();
  });
  results.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const links = [...results.querySelectorAll('a')];
    const index = links.indexOf(document.activeElement);
    if (event.key === 'ArrowUp' && index <= 0) input.focus();
    else links[Math.min(links.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))]?.focus();
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
  });
})();
