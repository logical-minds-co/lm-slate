import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import type { AppState, TabInfo } from '../shared/types';
import { SEARCH_ENGINES } from '../shared/search';

const slate = window.slate;
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const tabsEl = $('#tabs');
const urlForm = $<HTMLFormElement>('#urlform');
const urlInput = $<HTMLInputElement>('#url');
const content = $('#content');
const empty = $('#empty');

let state: AppState = { tabs: [], activeId: null, dark: false, clear: false, searchEngine: 'google', focus: null, focusDone: null, recording: null };

// ─── terminals ────────────────────────────────────────────────

interface Term { term: Terminal; fit: FitAddon; el: HTMLDivElement }
const terms = new Map<string, Term>();
const pending = new Map<string, string[]>();

const light: ITheme = {
  background: '#00000000',
  foreground: '#1c1c20',
  cursor: '#1c1c20',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(28,28,32,0.18)',
  black: '#2a2a2e', red: '#a63d40', green: '#3f7a4a', yellow: '#9a6b1f',
  blue: '#3b5f9e', magenta: '#7b4d9c', cyan: '#2d7a86', white: '#8a8a90',
  brightBlack: '#6a6a70', brightRed: '#c25054', brightGreen: '#4f9a5c', brightYellow: '#b8862b',
  brightBlue: '#4d77c0', brightMagenta: '#9660bd', brightCyan: '#3a97a6', brightWhite: '#1c1c20',
};

const dark: ITheme = {
  background: '#00000000',
  foreground: '#ececf0',
  cursor: '#ececf0',
  cursorAccent: '#000000',
  selectionBackground: 'rgba(236,236,240,0.22)',
  black: '#8a8a92', red: '#e07a7c', green: '#8fcf9a', yellow: '#e2c07a',
  blue: '#8fb0ef', magenta: '#c9a4ea', cyan: '#8fd5df', white: '#c8c8ce',
  brightBlack: '#a0a0a8', brightRed: '#f09294', brightGreen: '#a5e0af', brightYellow: '#f0d08f',
  brightBlue: '#a6c3f5', brightMagenta: '#d8b8f2', brightCyan: '#a6e2ea', brightWhite: '#ffffff',
};

function createTerm(id: string): Term {
  const el = document.createElement('div');
  el.className = 'term';
  el.hidden = true;
  content.appendChild(el);

  const term = new Terminal({
    allowTransparency: true,
    cursorStyle: 'bar',
    cursorBlink: false,
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--mono'),
    fontSize: 13,
    lineHeight: 1.25,
    letterSpacing: 0,
    scrollback: 5000,
    theme: state.dark ? dark : light,
    macOptionIsMeta: true,
  });
  // Leave ⌘-combos and ⌃Tab to the application menu: on macOS the page sees them first,
  // and xterm would otherwise swallow them before the accelerators fire.
  term.attachCustomKeyEventHandler((e) => !(e.metaKey || (e.ctrlKey && e.key === 'Tab')));
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => slate.newTab('browser', uri)));
  term.open(el);

  term.onData((d) => slate.ptyWrite(id, d));
  term.onResize(({ cols, rows }) => slate.ptyResize(id, cols, rows));
  term.onTitleChange((t) => slate.setTitle(id, t));

  const queued = pending.get(id);
  if (queued) { for (const d of queued) term.write(d); pending.delete(id); }

  const t = { term, fit, el };
  terms.set(id, t);
  return t;
}

function destroyTerm(id: string) {
  const t = terms.get(id);
  if (!t) return;
  t.term.dispose();
  t.el.remove();
  terms.delete(id);
}

const ro = new ResizeObserver(() => {
  const t = state.activeId && terms.get(state.activeId);
  if (t && !t.el.hidden) t.fit.fit();
});
ro.observe(content);

slate.onPtyData((id, data) => {
  const t = terms.get(id);
  if (t) t.term.write(data);
  else pending.set(id, [...(pending.get(id) ?? []), data]);
});
slate.onPtyExit((id) => destroyTerm(id));

// ─── address fields ───────────────────────────────────────────

const BLANK = 'about:blank';
const isBlank = (tab?: TabInfo) => tab?.kind === 'browser' && (!tab.url || tab.url === BLANK);
const activeTab = () => state.tabs.find((t) => t.id === state.activeId);

function renderTabs() {
  tabsEl.replaceChildren(
    ...state.tabs.map((tab) => {
      const b = document.createElement('button');
      b.className = 'tab' + (tab.id === state.activeId ? ' active' : '') + (tab.loading ? ' loading' : '');
      b.dataset.kind = tab.kind;
      b.title = tab.kind === 'browser' && tab.url ? tab.url : tab.title;

      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = tab.title;

      const close = document.createElement('span');
      close.className = 'close';
      close.textContent = '×';
      close.addEventListener('click', (e) => { e.stopPropagation(); slate.closeTab(tab.id); });

      b.append(title, close);
      b.addEventListener('click', () => slate.activate(tab.id));
      b.addEventListener('auxclick', (e) => { if (e.button === 1) slate.closeTab(tab.id); });
      return b;
    }),
  );
}

// Revealing the tab row: briefly after tab changes, or while Control is held.
const bar = $('#bar');
let peekTimer: number | undefined;
let ctrlTimer: number | undefined;
let ctrlHeld = false;

function peek(ms = 1200) {
  bar.classList.add('reveal');
  window.clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => { if (!ctrlHeld) bar.classList.remove('reveal'); }, ms);
}

function setModifier(held: boolean) {
  window.clearTimeout(ctrlTimer);
  if (held && !ctrlHeld) {
    // small delay so a quick ⌃C in the terminal doesn't flash the row
    ctrlTimer = window.setTimeout(() => { ctrlHeld = true; bar.classList.add('reveal'); }, 280);
  } else if (!held) {
    ctrlHeld = false;
    bar.classList.remove('reveal');
  }
}

slate.onPeek(() => peek());
slate.onModifier(setModifier);
window.addEventListener('keydown', (e) => { if (e.key === 'Control') setModifier(true); }, true);
window.addEventListener('keyup', (e) => { if (e.key === 'Control') setModifier(false); }, true);
window.addEventListener('blur', () => setModifier(false));

// Centered field: the whole UI of a blank browser tab.
const omni = $<HTMLFormElement>('#omni');
const omniInput = $<HTMLInputElement>('#omni-input');

function showOmni() {
  omniInput.placeholder = `Search ${SEARCH_ENGINES[state.searchEngine].label} or enter address`;
  if (omni.hidden) { omni.hidden = false; omniInput.value = ''; }
  // Always take focus: a blank tab has nothing else to type into, and if the window
  // itself isn't focused yet the call is harmless (focus lands here once it is).
  omniInput.focus();
}

omni.addEventListener('submit', (e) => {
  e.preventDefault();
  const active = activeTab();
  const value = omniInput.value.trim();
  if (active?.kind === 'browser' && value) slate.navigate(active.id, value);
});
omniInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') omniInput.value = '';
});

// Top-bar field: ⌘L on a page that is already loaded.
function showUrl(tab: TabInfo) {
  if (urlForm.hidden) {
    urlInput.value = tab.url ?? '';
    urlForm.hidden = false;
    tabsEl.style.visibility = 'hidden';
  }
  urlInput.focus();
  urlInput.select();
}

function hideUrl() {
  urlForm.hidden = true;
  tabsEl.style.visibility = '';
}

urlForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const active = activeTab();
  if (active?.kind === 'browser' && urlInput.value.trim()) {
    slate.navigate(active.id, urlInput.value);
    hideUrl();
  }
});
urlInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const active = activeTab();
  hideUrl();
  if (active) slate.activate(active.id); // hands focus back to the page
});
urlInput.addEventListener('blur', () => { if (!urlForm.hidden) hideUrl(); });

slate.onFocusUrl(() => {
  const active = activeTab();
  if (isBlank(active)) showOmni();
  else if (active?.kind === 'browser') showUrl(active);
});

// ─── overview support: terminal snapshots, hide terminals while the mosaic is up ──

slate.onSnapshotRequest(() => {
  const out: Record<string, { lines: string[]; cols: number; rows: number }> = {};
  for (const [id, t] of terms) {
    const buf = t.term.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buf.length - t.term.rows);
    for (let i = start; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    out[id] = { lines, cols: t.term.cols, rows: t.term.rows };
  }
  slate.sendSnapshots(out);
});
slate.onOverview((open) => document.documentElement.classList.toggle('overview', open));

// ─── screen recording (the MediaRecorder lives here; main writes the file) ──

let recorder: MediaRecorder | null = null;

slate.onRecStart(async ({ mode, mic }) => {
  try {
    let stream: MediaStream;
    const dpr = window.devicePixelRatio || 1;
    // window mode: ask for the window's physical size; glass mode: the whole screen at native size
    const video: MediaTrackConstraints = mode === 'window'
      ? { frameRate: { ideal: 60 }, width: { ideal: Math.round(window.outerWidth * dpr) }, height: { ideal: Math.round(window.outerHeight * dpr) } }
      : { frameRate: { ideal: 60 }, width: { ideal: 7680 }, height: { ideal: 4320 } };
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    } catch {
      // getDisplayMedia needs a user gesture in the page; fall back to the legacy desktop constraint
      const id = await slate.recSource();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 60 } },
      } as MediaStreamConstraints);
    }
    if (mic) {
      const voice = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      stream = new MediaStream([...stream.getVideoTracks(), ...voice.getAudioTracks()]);
    }
    // mp4/H.264 (+AAC) plays everywhere (QuickTime, iMovie, Keynote); webm is the fallback
    const candidates = mic
      ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
      : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 16_000_000, audioBitsPerSecond: 160_000 });
    let queue: Promise<void> = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      queue = queue.then(() => e.data.arrayBuffer()).then((b) => slate.recChunk(b));
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void queue.then(() => slate.recDone());
      recorder = null;
    };
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { if (rec.state !== 'inactive') rec.stop(); });
    slate.recStarted(mimeType); // main opens the file before the first chunk arrives
    rec.start(1000);
    recorder = rec;
  } catch (err) {
    recorder = null;
    slate.recDone(err instanceof Error ? err.message : String(err));
  }
});
slate.onRecStop(() => { if (recorder && recorder.state !== 'inactive') recorder.stop(); });

// ─── focus session countdown ──────────────────────────────────

const focusEl = $('#focus');
const focusTask = focusEl.querySelector('.task') as HTMLSpanElement;
const focusTime = focusEl.querySelector('.time') as HTMLSpanElement;
let focusTick: number | undefined;

function renderFocus() {
  window.clearInterval(focusTick);
  const f = state.focus;
  if (f) {
    focusEl.hidden = false;
    focusEl.classList.remove('done');
    focusTask.textContent = f.task;
    focusEl.title = `${f.task} · ${f.minutes} min · click to end`;
    const tick = () => {
      const left = Math.max(0, f.endsAt - Date.now());
      const m = Math.floor(left / 60_000);
      const s = Math.floor((left % 60_000) / 1000);
      focusTime.textContent = `${m}:${String(s).padStart(2, '0')}`;
    };
    tick();
    focusTick = window.setInterval(tick, 1000);
  } else if (state.focusDone) {
    focusEl.hidden = false;
    focusEl.classList.add('done');
    focusTask.textContent = state.focusDone;
    focusTime.textContent = 'done';
    focusEl.title = '';
  } else {
    focusEl.hidden = true;
  }
}
focusEl.addEventListener('click', () => { if (state.focus) slate.stopFocus(); });

// ─── state ────────────────────────────────────────────────────

function apply(next: AppState) {
  const prevDark = state.dark;
  state = next;

  document.documentElement.classList.toggle('dark', state.dark);
  document.documentElement.classList.toggle('clear', state.clear);
  if (prevDark !== state.dark) {
    for (const t of terms.values()) t.term.options.theme = state.dark ? dark : light;
  }

  // reconcile terminal instances with the tab list
  const ids = new Set(state.tabs.filter((t) => t.kind === 'terminal').map((t) => t.id));
  for (const id of terms.keys()) if (!ids.has(id)) destroyTerm(id);
  for (const id of ids) if (!terms.has(id)) createTerm(id);

  for (const [id, t] of terms) {
    const show = id === state.activeId;
    if (t.el.hidden === !show) continue;
    t.el.hidden = !show;
    if (show) { t.fit.fit(); t.term.focus(); }
  }
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active?.kind === 'terminal') terms.get(active.id)?.term.focus();

  empty.hidden = state.tabs.length > 0;
  if (isBlank(active)) showOmni();
  else omni.hidden = true;
  if (!urlForm.hidden && (active?.kind !== 'browser' || isBlank(active))) hideUrl();
  renderFocus();
  renderTabs();
}

slate.onState(apply);
void slate.getState().then((s) => s && apply(s));

// Keep the window focusable by keyboard when clicking on glass.
content.addEventListener('mousedown', () => {
  const active = state.tabs.find((t) => t.id === state.activeId);
  if (active?.kind === 'terminal') terms.get(active.id)?.term.focus();
});

window.addEventListener('focus', () => {
  if (isBlank(activeTab())) omniInput.focus();
});
