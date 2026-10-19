import { invoke } from '@tauri-apps/api/core';
import './styles/ai.css';

export type AiContext = {
  noteId: string;
  content: string;
  selectionStart: number;
  selectionEnd: number;
  /** Root applies through the editor's undo transaction and checks the captured text. */
  apply: (text: string, mode: 'replace' | 'insert') => Promise<void>;
  isCurrent: () => boolean;
};
type Prompt = { name: string; instruction: string };
type AiConfig = { enabled: boolean; endpoint: string; model: string; embeddingModel: string; transcriptionModel: string; prompts: Prompt[]; hasApiKey: boolean };
type Source = { id: string; title: string; excerpt: string; score: number };
const actions: Prompt[] = [
  { name: 'Summarize', instruction: 'Summarize the source text concisely. Preserve the key facts and decisions.' },
  { name: 'Improve writing', instruction: 'Improve clarity and grammar while preserving the original meaning, language, links, and Markdown structure.' },
  { name: 'Extract tasks', instruction: 'Extract only actionable tasks as Markdown checkboxes. Preserve owners and due dates when present. Do not invent tasks or dates.' },
];

export function aiDialog(title: string) {
  const requestId = crypto.randomUUID();
  const dialog = document.createElement('dialog');
  dialog.className = 'ai-dialog';
  dialog.setAttribute('aria-label', title);
  const heading = document.createElement('h2'); heading.textContent = title;
  const closeButton = button('Close', () => close()); closeButton.className = 'ai-close';
  const header = document.createElement('header'); header.append(heading, closeButton);
  const body = document.createElement('div'); body.className = 'ai-body';
  const status = document.createElement('p'); status.className = 'ai-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const footer = document.createElement('footer');
  dialog.append(header, body, status, footer); document.body.append(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.addEventListener('close', () => { void invoke('ai_cancel', { requestId }).catch(() => {}); dialog.remove(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if ((e as MouseEvent).clientX < r.left || (e as MouseEvent).clientX > r.right || (e as MouseEvent).clientY < r.top || (e as MouseEvent).clientY > r.bottom) close(); } });
  dialog.showModal();
  return { dialog, body, status, footer, close, requestId };
}
export function button(label: string, action: () => void) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b; }
export function paragraph(text: string) { const p = document.createElement('p'); p.textContent = text; return p; }
function field(parent: HTMLElement, label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) { const wrapper = document.createElement('label'); wrapper.className = 'ai-field'; wrapper.append(document.createTextNode(label), input); parent.append(wrapper); }
function input(value: string, type = 'text') { const e = document.createElement('input'); e.type = type; e.value = value; return e; }
export function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function config() { return invoke<AiConfig>('ai_get_config'); }
async function copy(text: string, status: HTMLElement) { try { await navigator.clipboard.writeText(text); status.textContent = 'Copied.'; } catch { status.textContent = 'Select the preview text and copy it with your keyboard.'; } }

export async function openAiSettings() {
  const ui = aiDialog('AI provider settings');
  try {
    const c = await config(); if (!ui.dialog.isConnected) return;
    ui.body.append(paragraph('Connect an OpenAI-compatible provider. Actions send selected text; indexing sends eligible note titles and the first 12,000 characters of each note. Use ai_exclude: true to keep a note out of integrated AI and AI-facing vault access.'));
    const enabled = input('', 'checkbox'); enabled.checked = c.enabled; field(ui.body, 'Enable AI with this provider', enabled);
    const endpoint = input(c.endpoint); field(ui.body, 'API base URL (including /v1 when required)', endpoint);
    const key = input('', 'password'); key.autocomplete = 'new-password'; key.placeholder = c.hasApiKey ? 'A key is saved. Leave blank to keep it.' : 'API key (optional for a local provider)'; field(ui.body, 'API key', key);
    const removeKey = input('', 'checkbox'); field(ui.body, 'Remove saved API key', removeKey);
    const model = input(c.model); field(ui.body, 'Chat model', model);
    const embedding = input(c.embeddingModel); field(ui.body, 'Embedding model', embedding);
    const transcription = input(c.transcriptionModel); field(ui.body, 'Transcription model', transcription);
    ui.body.append(paragraph('The key is saved in a private app configuration file outside the vault, restricted to your user account on macOS. It is never stored in browser storage. Semantic vectors stay in memory until Tagdown quits.'));
    const prompts = document.createElement('div'); prompts.className = 'ai-prompts'; ui.body.append(prompts);
    const rows: { row: HTMLElement; name: HTMLInputElement; instruction: HTMLTextAreaElement }[] = [];
    const add = (p: Prompt = { name: '', instruction: '' }) => {
      const row = document.createElement('div'); row.className = 'ai-prompt';
      const name = input(p.name); name.placeholder = 'Prompt name'; field(row, 'Saved action name', name);
      const instruction = document.createElement('textarea'); instruction.value = p.instruction; instruction.rows = 3; field(row, 'Instruction', instruction);
      row.append(button('Remove action', () => { row.remove(); rows.splice(rows.findIndex(x => x.row === row), 1); })); prompts.append(row); rows.push({ row, name, instruction });
    };
    c.prompts.forEach(add); ui.body.append(button('Add saved action', () => add()));
    const save = button('Save provider settings', () => { void (async () => {
      save.disabled = true;
      try {
        await invoke('ai_save_config', { config: { enabled: enabled.checked, endpoint: endpoint.value.trim(), model: model.value.trim(), embeddingModel: embedding.value.trim(), transcriptionModel: transcription.value.trim(), prompts: rows.map(r => ({ name: r.name.value.trim(), instruction: r.instruction.value.trim() })) }, apiKey: removeKey.checked ? '' : key.value.trim() || null });
        key.value = ''; ui.close();
      } catch (e) { ui.status.textContent = errorText(e); save.disabled = false; }
    })(); });
    save.className = 'is-primary'; ui.footer.append(save);
  } catch (e) { ui.status.textContent = errorText(e); }
}

export async function openAiActions(context: AiContext) {
  const ui = aiDialog('AI writing actions');
  try {
    const c = await config(); if (!ui.dialog.isConnected) return;
    if (!c.enabled) { ui.body.append(paragraph('Enable a provider in AI settings to use writing actions.')); ui.footer.append(button('AI settings', () => { ui.close(); void openAiSettings(); })); return; }
    const selected = context.content.slice(context.selectionStart, context.selectionEnd);
    ui.body.append(paragraph(selected ? 'Only the selected text will be sent to your provider. Review and edit the result before applying it.' : 'Select text in the note to use AI writing actions.'));
    if (!selected.trim()) return;
    const selector = document.createElement('select');
    [...actions, ...c.prompts, { name: 'Custom instruction', instruction: '' }].forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = p.name; selector.append(o); });
    field(ui.body, 'Action', selector);
    const instruction = document.createElement('textarea'); instruction.rows = 3; instruction.value = actions[0].instruction; field(ui.body, 'Instruction', instruction);
    selector.addEventListener('change', () => { instruction.value = [...actions, ...c.prompts][Number(selector.value)]?.instruction ?? ''; });
    const preview = document.createElement('textarea'); preview.className = 'ai-result'; preview.rows = 12; preview.placeholder = 'Your editable result appears here.'; field(ui.body, 'Preview', preview);
    const apply = button('Replace selection', () => { void applyResult('replace'); });
    const insert = button('Insert after selection', () => { void applyResult('insert'); });
    const applyResult = async (mode: 'replace' | 'insert') => {
      if (!preview.value.trim()) return;
      if (!context.isCurrent()) { ui.status.textContent = 'The note changed. Close this preview and run the action again.'; return; }
      try { apply.disabled = insert.disabled = true; await context.apply(preview.value, mode); ui.close(); }
      catch (e) { ui.status.textContent = errorText(e); apply.disabled = insert.disabled = false; }
    };
    apply.disabled = insert.disabled = true;
    const run = button('Generate preview', () => { void (async () => {
      run.disabled = true; apply.disabled = insert.disabled = true; ui.status.textContent = 'Waiting for your provider…';
      try {
        const result = await invoke<string>('ai_transform', { id: context.noteId, text: selected, instruction: instruction.value, requestId: ui.requestId });
        if (!ui.dialog.isConnected) return;
        preview.value = result; apply.disabled = insert.disabled = false; ui.status.textContent = 'Review the result. Applying it can be undone in the editor.';
      } catch (e) { if (ui.dialog.isConnected) ui.status.textContent = errorText(e); }
      finally { run.disabled = false; }
    })(); });
    ui.footer.append(button('Saved actions / settings', () => { ui.close(); void openAiSettings(); }), button('Copy preview', () => { void copy(preview.value, ui.status); }), run, insert, apply);
  } catch (e) { ui.status.textContent = errorText(e); }
}

function sourceList(parent: HTMLElement, sources: Source[], openNote: (id: string) => void, close: () => void) {
  const list = document.createElement('ol'); list.className = 'ai-sources';
  sources.forEach(s => { const row = document.createElement('li'); const b = button(s.title || 'Untitled', () => { close(); openNote(s.id); }); const excerpt = document.createElement('small'); excerpt.textContent = s.excerpt.slice(0, 220); row.append(b, excerpt); list.append(row); });
  parent.append(list);
}

function indexButton(ui: ReturnType<typeof aiDialog>) {
  const b = button('Build / update semantic index', () => { void (async () => {
    b.disabled = true; ui.status.textContent = 'Indexing eligible notes with your embedding provider…';
    try { const result = await invoke<{ indexed: number; updated: number }>('ai_index', { requestId: ui.requestId }); if (ui.dialog.isConnected) ui.status.textContent = `${result.indexed} notes indexed, ${result.updated} updated. Edited, deleted, archived, and excluded notes are checked on every search.`; }
    catch (e) { if (ui.dialog.isConnected) ui.status.textContent = errorText(e); }
    finally { b.disabled = false; }
  })(); }); return b;
}

export function openAskVault(openNote: (id: string) => void) {
  const ui = aiDialog('Ask this vault');
  ui.body.append(paragraph('Build the index to send eligible note titles and their first 12,000 characters to your embedding provider. Questions send the five closest indexed excerpts to your chat provider. Excluded and archived notes are skipped. The index lasts until Tagdown quits.'));
  const question = document.createElement('textarea'); question.rows = 3; question.placeholder = 'What would you like to find out?'; field(ui.body, 'Question', question);
  const answer = document.createElement('div'); answer.className = 'ai-answer'; answer.setAttribute('aria-live', 'polite'); ui.body.append(answer);
  const ask = button('Ask', () => { void (async () => {
    if (!question.value.trim()) { question.focus(); return; }
    ask.disabled = true; ui.status.textContent = 'Finding relevant notes and asking your provider…';
    try {
      const result = await invoke<{ answer: string; sources: Source[] }>('ai_ask', { question: question.value.trim(), requestId: ui.requestId });
      if (!ui.dialog.isConnected) return;
      answer.replaceChildren();
      const text = document.createElement('div'); text.className = 'ai-answer-text';
      // Only actual retrieved sources become clickable citations.
      result.answer.split(/(\[\d+\])/).forEach(part => { const match = /^\[(\d+)\]$/.exec(part); const source = match ? result.sources[Number(match[1]) - 1] : undefined; text.append(source ? button(part, () => { ui.close(); openNote(source.id); }) : document.createTextNode(part)); });
      answer.append(text); sourceList(answer, result.sources, openNote, ui.close); ui.status.textContent = 'Check the cited notes to verify the answer.';
    } catch (e) { if (ui.dialog.isConnected) ui.status.textContent = errorText(e); }
    finally { ask.disabled = false; }
  })(); });
  ui.footer.append(button('AI settings', () => { ui.close(); void openAiSettings(); }), indexButton(ui), ask); question.focus();
}

export function openRelatedNotes(context: AiContext, openNote: (id: string) => void) {
  const ui = aiDialog('Semantically related notes');
  ui.body.append(paragraph('Build the semantic index to send eligible note titles and their first 12,000 characters to your embedding provider. Find related notes sends the current saved note to that provider. Similarity uses embeddings, and only unchanged indexed notes are returned.'));
  const results = document.createElement('div'); ui.body.append(results);
  const search = button('Find related notes', () => { void (async () => {
    search.disabled = true; ui.status.textContent = 'Finding related notes…';
    try { const sources = await invoke<Source[]>('ai_related', { id: context.noteId, requestId: ui.requestId }); if (!ui.dialog.isConnected) return; results.replaceChildren(); sourceList(results, sources, openNote, ui.close); ui.status.textContent = sources.length ? 'Notes ranked by embedding similarity.' : 'No other indexed notes yet.'; }
    catch (e) { if (ui.dialog.isConnected) ui.status.textContent = errorText(e); }
    finally { search.disabled = false; }
  })(); }); ui.footer.append(indexButton(ui), search);
}
