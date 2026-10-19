import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { aiDialog, button, errorText, paragraph, type AiContext } from './ai';

/** Recorded attachments remain playable from ordinary portable Markdown links. */
document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[href]');
  const path = link?.getAttribute('href') ?? '';
  if (!/^attachments\/voice-[a-f0-9]{16}-[a-f0-9-]+\.(?:webm|mp4|ogg|wav)$/.test(path)) return;
  event.preventDefault(); event.stopPropagation();
  const ui = aiDialog('Voice recording');
  const audio = document.createElement('audio'); audio.controls = true; ui.body.append(audio);
  audio.addEventListener('error', () => { ui.status.textContent = 'The recording could not be played. Check that the attachment is still in this vault.'; });
  void invoke<string>('vault_path').then(root => { if (ui.dialog.isConnected) { audio.src = convertFileSrc(`${root.replace(/\/+$/, '')}/${path}`); void audio.play().catch(() => { ui.status.textContent = 'Press play to listen to this recording.'; }); } }).catch(e => { ui.status.textContent = errorText(e); });
  ui.dialog.addEventListener('close', () => { audio.pause(); audio.removeAttribute('src'); });
}, { capture: true });

/** Recording stays local until the user explicitly requests transcription. */
export function openVoiceCapture(context: AiContext) {
  const ui = aiDialog('Voice capture');
  ui.body.append(paragraph('Record a thought and save the audio in this vault. Transcribe sends the recording to your configured AI provider. You can edit the transcript before inserting it. Recordings are limited to 24 MB.'));
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { ui.status.textContent = 'Microphone recording is unavailable in this webview. Check microphone permission and try again.'; return; }
  const playback = document.createElement('audio'); playback.controls = true; playback.hidden = true;
  const preview = document.createElement('textarea'); preview.rows = 9; preview.placeholder = 'Your editable transcript appears here.'; preview.setAttribute('aria-label', 'Editable transcript');
  ui.body.append(playback, preview);
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let blob: Blob | undefined;
  let savedPath = '';
  let saving: Promise<string> | undefined;
  let objectUrl = '';
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopStream = () => { stream?.getTracks().forEach(track => track.stop()); stream = undefined; if (timer) clearTimeout(timer); };
  const cleanup = () => { if (closed) return; closed = true; if (recorder?.state === 'recording') recorder.stop(); stopStream(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  ui.dialog.addEventListener('close', cleanup);
  // Native Escape emits cancel before the dialog is removed.
  ui.dialog.addEventListener('cancel', cleanup);
  const stop = button('Stop recording', () => { if (recorder?.state === 'recording') recorder.stop(); }); stop.disabled = true;
  const start = button('Start recording', () => { void (async () => {
    start.disabled = true;
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (closed || !ui.dialog.isConnected) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = []; let size = 0;
      recorder.addEventListener('dataavailable', event => { if (event.data.size) { chunks.push(event.data); size += event.data.size; if (size > 23 * 1024 * 1024 && recorder?.state === 'recording') recorder.stop(); } });
      recorder.addEventListener('stop', () => {
        stopStream(); stop.disabled = true;
        if (closed) return;
        blob = new Blob(chunks, { type: recorder?.mimeType || mime || 'audio/mp4' });
        if (blob.size > 24 * 1024 * 1024) { blob = undefined; ui.status.textContent = 'The recording exceeded 24 MB. Record a shorter clip.'; start.disabled = false; return; }
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob); playback.src = objectUrl; playback.hidden = false;
        save.disabled = false; transcribe.disabled = false; ui.status.textContent = 'Recording ready. Save it locally or transcribe it with your provider.';
      });
      recorder.addEventListener('error', () => { stopStream(); ui.status.textContent = 'The microphone recording failed. Close this dialog and try again.'; });
      recorder.start(1000); stop.disabled = false; ui.status.textContent = 'Recording…';
      // Keep recording bounded even if the webview emits little compressed audio.
      timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 15 * 60 * 1000);
    } catch (e) { stopStream(); ui.status.textContent = `Microphone unavailable: ${errorText(e)}`; start.disabled = false; }
  })(); });
  const persist = async () => {
    if (!context.isCurrent()) throw new Error('The note changed. Reopen voice capture in the intended note before saving or transcribing.');
    if (savedPath) return savedPath;
    if (!blob) throw new Error('Record some audio first.');
    const extension = blob.type.includes('webm') ? 'webm' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'mp4';
    if (!saving) {
      const recording = blob;
      saving = recording.arrayBuffer().then(bytes => invoke<string>('save_audio_attachment', bytes, { headers: { 'x-note-id': context.noteId, 'x-audio-extension': extension } }));
    }
    try { savedPath = await saving; } catch (error) { saving = undefined; throw error; }
    return savedPath;
  };
  const save = button('Save recording', () => { void (async () => {
    save.disabled = true;
    try { const path = await persist(); ui.status.textContent = `Saved as ${path}. Insert it into the note to keep a link.`; insert.disabled = false; }
    catch (e) { ui.status.textContent = errorText(e); save.disabled = false; }
  })(); }); save.disabled = true;
  const transcribe = button('Transcribe with provider', () => { void (async () => {
    transcribe.disabled = save.disabled = true;
    try {
      const path = await persist(); if (closed) return;
      if (!context.isCurrent()) throw new Error('The note changed. Reopen voice capture in the intended note before transcribing.');
      ui.status.textContent = 'Transcribing with your provider…';
      const text = await invoke<string>('ai_transcribe', { id: context.noteId, path, requestId: ui.requestId });
      if (closed) return; preview.value = text; insert.disabled = false; ui.status.textContent = 'Review and edit the transcript, then insert it with the audio link.';
    } catch (e) { if (!closed) ui.status.textContent = errorText(e); }
    finally { transcribe.disabled = false; insert.disabled = !savedPath; }
  })(); }); transcribe.disabled = true;
  const insert = button('Insert audio and transcript', () => { void (async () => {
    if (!context.isCurrent()) { ui.status.textContent = 'The note changed. Copy the transcript and insert it into the intended note.'; return; }
    insert.disabled = true;
    try { const path = await persist(); await context.apply(`\n\n[Voice recording](${path})${preview.value.trim() ? `\n\n${preview.value.trim()}` : ''}\n`, 'insert'); ui.close(); }
    catch (e) { ui.status.textContent = errorText(e); insert.disabled = false; }
  })(); }); insert.disabled = true;
  ui.footer.append(start, stop, save, transcribe, insert);
}
