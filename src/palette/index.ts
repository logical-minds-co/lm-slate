import './styles.css';
import { COMMANDS, type PalettePayload } from '../shared/palette';
import { SEARCH_ENGINES, type SearchEngine } from '../shared/search';
import type { OverviewPayload } from '../shared/overview';

const slate = window.slate;
const q = document.getElementById('q') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;
const backdrop = document.getElementById('backdrop') as HTMLDivElement;

interface Item {
  section: 'slates' | 'commands' | 'search' | 'go';
  action: string;
  label: string;
  glyph?: string;
  hint?: string;
  keys?: string;
  mono?: boolean;
  active?: boolean;
}

let payload: PalettePayload | null = null;
let items: Item[] = [];
let selected = 0;
let mode: 'list' | 'focus' = 'list';

const LIST_PLACEHOLDER = 'slate, command, address or search';
const FOCUS_PLACEHOLDER = 'what are you working on? — add minutes at the end';

// ─── building the list ────────────────────────────────────────

function allItems(p: PalettePayload): Item[] {
  const active = p.tabs.find((t) => t.id === p.activeId);
  const out: Item[] = [];

  for (const t of p.tabs) {
    out.push({
      section: 'slates',
      action: `tab:${t.id}`,
      label: t.title,
      glyph: t.kind === 'terminal' ? '›' : '◦',
      hint: t.kind === 'browser' && t.url && t.url !== 'about:blank' ? host(t.url) : undefined,
      mono: t.kind === 'terminal',
      active: t.id === p.activeId,
    });
  }

  for (const c of COMMANDS) {
    if ('browser' in c && c.browser && active?.kind !== 'browser') continue;
    if ('focusOnly' in c && c.focusOnly && !p.focus) continue;
    if ('notWhileRecording' in c && c.notWhileRecording && p.recording) continue;
    let label: string = c.label;
    if (c.id === 'theme') label = p.dark ? 'Light ink' : 'Dark ink';
    if (c.id === 'glass') label = p.clear ? 'Frosted glass' : 'Clear glass';
    if (c.id === 'record') label = p.recording ? 'Stop screen recording' : 'Start screen recording';
    out.push({ section: 'commands', action: `cmd:${c.id}`, label, keys: 'keys' in c ? c.keys : undefined });
  }

  for (const key of Object.keys(SEARCH_ENGINES) as SearchEngine[]) {
    out.push({
      section: 'search',
      action: `engine:${key}`,
      label: `Search with ${SEARCH_ENGINES[key].label}`,
      active: key === p.searchEngine,
    });
  }
  return out;
}

/** Subsequence match; returns a score (higher is better) or -1. */
function score(text: string, query: string): number {
  const t = text.toLowerCase();
  const idx = t.indexOf(query);
  if (idx === 0) return 100;
  if (idx > 0) return t[idx - 1] === ' ' ? 80 : 60;
  let ti = 0, hits = 0;
  for (const ch of query) {
    ti = t.indexOf(ch, ti);
    if (ti < 0) return -1;
    ti++; hits++;
  }
  return 20 + hits;
}

/** "write the report 25" → { task: 'write the report', minutes: 25 } */
function parseFocus(text: string, fallback: number): { task: string; minutes: number } {
  const m = text.trim().match(/^(.*?)\s+(\d{1,3})\s*(m|min|mins|minutes)?$/i);
  if (m && m[1].trim()) return { task: m[1].trim(), minutes: Number(m[2]) };
  return { task: text.trim(), minutes: fallback };
}

function focusItems(): Item[] {
  if (!payload) return [];
  const { task, minutes } = parseFocus(q.value, payload.focusMinutes);
  if (!task) return [{ section: 'go', action: '', label: `type a task — e.g. “write the report 25”`, glyph: '●' }];
  return [{ section: 'go', action: `focus:${minutes}:${task}`, label: `Start “${task}”`, hint: `${minutes} min`, glyph: '●' }];
}

function setMode(next: 'list' | 'focus') {
  mode = next;
  q.value = '';
  q.placeholder = next === 'focus' ? FOCUS_PLACEHOLDER : LIST_PLACEHOLDER;
  selected = 0;
  render();
}

function filtered(): Item[] {
  if (!payload) return [];
  if (mode === 'focus') return focusItems();
  const query = q.value.trim().toLowerCase();
  const base = allItems(payload);
  if (!query) return base;

  const ranked = base
    .map((it) => ({ it, s: Math.max(score(it.label, query), it.hint ? score(it.hint, query) - 10 : -1) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);

  ranked.push({
    section: 'go',
    action: `go:${q.value.trim()}`,
    label: looksLikeUrl(q.value.trim()) ? `Open ${q.value.trim()}` : `Search ${SEARCH_ENGINES[payload.searchEngine].label} for “${q.value.trim()}”`,
    glyph: '↵',
  });
  return ranked;
}

const SECTION_LABEL = { slates: 'Slates', commands: 'Commands', search: 'Search engine', go: 'Go' };
const sectionLabel = (sec: Item['section']) => (mode === 'focus' ? 'Focus session' : SECTION_LABEL[sec]);

function render() {
  items = filtered();
  selected = Math.min(selected, Math.max(0, items.length - 1));
  const frag = document.createDocumentFragment();
  let lastSection: Item['section'] | null = null;

  items.forEach((it, i) => {
    if (it.section !== lastSection) {
      const h = document.createElement('li');
      h.className = 'section';
      h.textContent = sectionLabel(it.section);
      frag.appendChild(h);
      lastSection = it.section;
    }
    const li = document.createElement('li');
    li.className = 'item' + (i === selected ? ' selected' : '');
    li.dataset.index = String(i);
    if (it.mono) li.dataset.mono = '1';

    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = it.glyph ?? '';

    const label = document.createElement('span');
    label.className = 'label';
    label.append(...highlight(it.label, q.value.trim()));

    li.append(glyph, label);
    if (it.hint) { const h = document.createElement('span'); h.className = 'hint'; h.textContent = it.hint; li.appendChild(h); }
    if (it.active) { const d = document.createElement('span'); d.className = 'active-dot'; li.appendChild(d); }
    if (it.keys) { const k = document.createElement('span'); k.className = 'keys'; k.textContent = it.keys; li.appendChild(k); }

    li.addEventListener('mousemove', () => { if (selected !== i) { selected = i; render(); } });
    li.addEventListener('click', () => run(i));
    frag.appendChild(li);
  });

  list.replaceChildren(frag);
  list.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

function highlight(text: string, query: string): (string | HTMLElement)[] {
  if (!query) return [text];
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return [text];
  const m = document.createElement('mark');
  m.textContent = text.slice(idx, idx + query.length);
  return [text.slice(0, idx), m, text.slice(idx + query.length)];
}

function run(i: number) {
  const it = items[i];
  if (!it || !it.action) return;
  if (it.action === 'cmd:focus') { setMode('focus'); return; } // handled in-page, no round trip
  slate.paletteRun(it.action);
}

// ─── wiring ───────────────────────────────────────────────────

q.addEventListener('input', () => { selected = 0; render(); });
q.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowDown': e.preventDefault(); selected = (selected + 1) % Math.max(1, items.length); render(); break;
    case 'ArrowUp': e.preventDefault(); selected = (selected - 1 + items.length) % Math.max(1, items.length); render(); break;
    case 'Enter': e.preventDefault(); run(selected); break;
    case 'Escape':
      e.preventDefault();
      if (mode === 'focus') setMode('list');
      else slate.paletteClose();
      break;
    case 'Backspace':
      // ⌘⌫ on a slate closes it
      if (e.metaKey && items[selected]?.action.startsWith('tab:')) {
        e.preventDefault();
        slate.paletteRun(items[selected].action.replace('tab:', 'close:'));
      }
      break;
  }
});
backdrop.addEventListener('mousedown', () => slate.paletteClose());

slate.onPaletteOpen((p) => {
  payload = p;
  document.documentElement.classList.toggle('dark', p.dark);
  mode = p.mode ?? 'list';
  q.value = '';
  q.placeholder = mode === 'focus' ? FOCUS_PLACEHOLDER : LIST_PLACEHOLDER;
  selected = mode === 'focus' ? 0 : Math.max(0, p.tabs.findIndex((t) => t.id === p.activeId));
  render();
  document.documentElement.classList.add('open');
  q.focus();
});
slate.onPaletteClose(() => {
  document.documentElement.classList.remove('open', 'overview', 'countdown');
  overviewEl.hidden = true;
  overviewEl.replaceChildren();
  stopCountdown();
});

// ─── recording countdown ──────────────────────────────────────

const countdownEl = document.getElementById('countdown') as HTMLDivElement;
const digitEl = countdownEl.querySelector('.digit') as HTMLDivElement;
let countdownTimer: number | undefined;

function stopCountdown() {
  window.clearInterval(countdownTimer);
  countdownTimer = undefined;
  countdownEl.hidden = true;
}

slate.onCountdown((seconds, dark) => {
  stopCountdown();
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.add('open', 'countdown');
  countdownEl.hidden = false;
  let n = seconds;
  const show = () => {
    digitEl.textContent = String(n);
    digitEl.style.animation = 'none';
    void digitEl.offsetWidth; // restart the tick animation
    digitEl.style.animation = '';
  };
  show();
  countdownTimer = window.setInterval(() => {
    n -= 1;
    if (n <= 0) {
      stopCountdown();
      slate.paletteRun('countdown-done'); // main hides the overlay before capture begins
      return;
    }
    show();
  }, 1000);
  countdownEl.focus();
});
countdownEl.tabIndex = -1;

// ─── overview / mosaic ────────────────────────────────────────

const overviewEl = document.getElementById('overview') as HTMLDivElement;
let ov: OverviewPayload | null = null;
let ovSelected = 0;

function renderOverview() {
  if (!ov) return;
  overviewEl.replaceChildren(...ov.cells.map((c, i) => {
    const el = document.createElement('div');
    el.className = 'cell' + (c.active ? ' active' : '') + (i === ovSelected ? ' selected' : '');
    el.dataset.kind = c.kind;
    el.style.left = `${c.rect.x}px`;
    el.style.top = `${c.rect.y}px`;
    el.style.width = `${c.rect.width}px`;
    el.style.height = `${c.rect.height}px`;

    if (c.kind === 'terminal') {
      const pre = document.createElement('pre');
      // shrink the snapshot towards fitting the terminal's width, but never below legibility;
      // long lines simply clip at the cell edge
      const cols = Math.max(20, c.cols ?? 80);
      pre.style.fontSize = `${Math.max(6.5, Math.min(13, (c.rect.width * 0.92) / (cols * 0.6)))}px`;
      pre.textContent = (c.lines ?? []).join('\n');
      el.appendChild(pre);
    }

    const name = document.createElement('div');
    name.className = 'name';
    const idx = document.createElement('span'); idx.className = 'index'; idx.textContent = i < 9 ? String(i + 1) : '';
    const glyph = document.createElement('span'); glyph.className = 'glyph'; glyph.textContent = c.kind === 'terminal' ? '›' : '◦';
    const title = document.createElement('span'); title.className = 'title'; title.textContent = c.title;
    name.append(idx, glyph, title);
    el.appendChild(name);

    el.addEventListener('mousemove', () => { if (ovSelected !== i) { ovSelected = i; renderOverview(); } });
    el.addEventListener('click', (e) => { e.stopPropagation(); slate.paletteRun(`pick:${c.id}`); });
    return el;
  }));
}

function moveSelection(dx: number, dy: number) {
  if (!ov) return;
  const cur = ov.cells[ovSelected];
  if (!cur) return;
  if (dy === 0) {
    ovSelected = (ovSelected + dx + ov.cells.length) % ov.cells.length;
  } else {
    // nearest cell in the row above/below, by horizontal centre
    const cx = cur.rect.x + cur.rect.width / 2;
    const candidates = ov.cells
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => (dy > 0 ? c.rect.y > cur.rect.y : c.rect.y < cur.rect.y));
    if (candidates.length === 0) return;
    const rowY = dy > 0 ? Math.min(...candidates.map(({ c }) => c.rect.y)) : Math.max(...candidates.map(({ c }) => c.rect.y));
    const row = candidates.filter(({ c }) => c.rect.y === rowY);
    ovSelected = row.reduce((best, cand) =>
      Math.abs(cand.c.rect.x + cand.c.rect.width / 2 - cx) < Math.abs(best.c.rect.x + best.c.rect.width / 2 - cx) ? cand : best,
    ).i;
  }
  renderOverview();
}

slate.onOverviewOpen((p) => {
  ov = p;
  ovSelected = Math.max(0, p.cells.findIndex((c) => c.active));
  document.documentElement.classList.toggle('dark', p.dark);
  document.documentElement.classList.add('open', 'overview');
  overviewEl.hidden = false;
  renderOverview();
  overviewEl.focus();
});

overviewEl.tabIndex = -1;
overviewEl.addEventListener('click', () => slate.paletteClose());
window.addEventListener('keydown', (e) => {
  if (!countdownEl.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); slate.paletteClose(); }
    return;
  }
  if (!ov || overviewEl.hidden) return;
  switch (e.key) {
    case 'Escape': e.preventDefault(); slate.paletteClose(); break;
    case 'Enter': e.preventDefault(); { const c = ov.cells[ovSelected]; if (c) slate.paletteRun(`pick:${c.id}`); } break;
    case 'ArrowRight': e.preventDefault(); moveSelection(1, 0); break;
    case 'ArrowLeft': e.preventDefault(); moveSelection(-1, 0); break;
    case 'ArrowDown': e.preventDefault(); moveSelection(0, 1); break;
    case 'ArrowUp': e.preventDefault(); moveSelection(0, -1); break;
    default:
      if (/^[1-9]$/.test(e.key)) { const c = ov.cells[Number(e.key) - 1]; if (c) slate.paletteRun(`pick:${c.id}`); }
  }
});

function host(url: string) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; }
}
function looksLikeUrl(s: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || /^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(s) || /^localhost/.test(s);
}
