// Presentation mode: a note shown full screen as slides, one per `---`.
//
// Slides are laid out on a fixed 16:9 canvas and scaled to the screen, so a
// deck looks the same on a laptop and a projector. A slide with more than fits
// shrinks its text rather than scrolling.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { renderPreview, applyExternals } from './tagdown/renderer';
import { splitSlides, slideAtLine } from './tagdown/slides';
import './styles/presentation.css';

const WIDTH = 1280;
const HEIGHT = 720;
const MIN_FIT = 0.55;

type PresentOptions = {
  title: string;
  source: string;
  /** Line the cursor is on, to start from the slide holding it. */
  fromLine: number;
  theme: 'light' | 'dark';
  /** Fills live parts such as query blocks. */
  decorate?: (root: HTMLElement) => Promise<void>;
};

let active = false;

export async function startPresentation(options: PresentOptions) {
  if (active) return;
  const slides = splitSlides(options.source);
  if (!slides.length) return;
  active = true;

  const overlay = document.createElement('div');
  overlay.className = 'presentation';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-roledescription', 'presentation');
  overlay.setAttribute('aria-label', options.title || 'Presentation');
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="presentation-stage">
      ${slides.map((slide, n) => `
        <section class="presentation-slide" aria-label="Slide ${n + 1} of ${slides.length}" hidden>
          <div class="preview presentation-content">${renderPreview(slide.text)}</div>
        </section>`).join('')}
    </div>
    <div class="presentation-progress" aria-hidden="true"><i></i></div>
    <div class="presentation-bar">
      <button type="button" data-prev aria-label="Previous slide">‹</button>
      <span class="presentation-count" aria-live="polite"></span>
      <button type="button" data-next aria-label="Next slide">›</button>
      <button type="button" data-exit class="presentation-exit">Exit <kbd>esc</kbd></button>
    </div>`;
  document.body.append(overlay);

  const stage = overlay.querySelector<HTMLElement>('.presentation-stage')!;
  const sections = Array.from(overlay.querySelectorAll<HTMLElement>('.presentation-slide'));
  const count = overlay.querySelector<HTMLElement>('.presentation-count')!;
  const progress = overlay.querySelector<HTMLElement>('.presentation-progress i')!;
  const fitted = new Set<number>();
  let index = Math.min(slideAtLine(slides, options.fromLine), slides.length - 1);

  sections.forEach((section) => {
    const content = section.querySelector<HTMLElement>('.presentation-content')!;
    if (isTitleSlide(content)) section.classList.add('is-title');
  });

  const scaleToScreen = () => {
    const scale = Math.min(window.innerWidth / WIDTH, window.innerHeight / HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  };

  /** Shrink a slide's text until it fits the canvas. */
  const fit = (n: number) => {
    if (fitted.has(n)) return;
    const content = sections[n].querySelector<HTMLElement>('.presentation-content')!;
    let size = 1;
    content.style.setProperty('--fit', '1');
    while (content.scrollHeight > content.clientHeight + 1 && size > MIN_FIT) {
      size = Math.max(MIN_FIT, size - 0.05);
      content.style.setProperty('--fit', String(size));
    }
    // Still too much at the smallest size: let it scroll rather than cut text off.
    content.classList.toggle('is-overflowing', content.scrollHeight > content.clientHeight + 1);
    fitted.add(n);
  };

  const show = (n: number) => {
    index = Math.max(0, Math.min(slides.length - 1, n));
    sections.forEach((section, i) => { section.hidden = i !== index; });
    fit(index);
    count.textContent = `${index + 1} / ${slides.length}`;
    progress.style.width = `${((index + 1) / slides.length) * 100}%`;
  };

  // Hide the cursor and controls while presenting; bring them back on movement.
  let idleTimer: number | undefined;
  const wake = () => {
    overlay.classList.remove('is-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => overlay.classList.add('is-idle'), 2000);
  };

  const appWindow = (() => { try { return getCurrentWindow(); } catch { return null; } })();
  const wasFullscreen = await appWindow?.isFullscreen().catch(() => true) ?? true;
  if (!wasFullscreen) await appWindow?.setFullscreen(true).catch(() => undefined);

  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const next = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(event.key);
    const prev = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(event.key);
    if (next || prev || ['Home', 'End', 'Escape'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (next) show(index + 1);
    else if (prev) show(index - 1);
    else if (event.key === 'Home') show(0);
    else if (event.key === 'End') show(slides.length - 1);
    else if (event.key === 'Escape') void exit();
    wake();
  };

  const exit = async () => {
    if (!active) return;
    active = false;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    window.clearTimeout(idleTimer);
    overlay.remove();
    if (!wasFullscreen) await appWindow?.setFullscreen(false).catch(() => undefined);
  };

  const onResize = () => { scaleToScreen(); };
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  overlay.addEventListener('mousemove', wake);
  overlay.querySelector('[data-prev]')!.addEventListener('click', () => show(index - 1));
  overlay.querySelector('[data-next]')!.addEventListener('click', () => show(index + 1));
  overlay.querySelector('[data-exit]')!.addEventListener('click', () => void exit());
  stage.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    // Links stay on the slide; checkboxes and controls in it keep working.
    if (target.closest('a')) { event.preventDefault(); return; }
    if (target.closest('input, button, summary, label, .td-tabs')) return;
    show(index + 1);
  });

  scaleToScreen();
  show(index);
  overlay.focus();
  wake();

  // Math, diagrams and queries render after the slides are on screen.
  await applyExternals(stage, options.theme);
  if (options.decorate) await options.decorate(stage);
  fitted.clear();
  if (active) show(index);
}

/** Only headings and at most one short paragraph: center it like a title slide. */
function isTitleSlide(content: HTMLElement) {
  const children = Array.from(content.children);
  const headings = children.filter((el) => /^H[1-3]$/.test(el.tagName));
  const others = children.filter((el) => !/^H[1-6]$/.test(el.tagName));
  return headings.length > 0 && others.length <= 1 && others.every((el) => el.tagName === 'P' && (el.textContent ?? '').length < 160);
}
