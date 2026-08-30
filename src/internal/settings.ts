import './internal.css';
import type { Prefs } from '../shared/types';

const api = window.slateInternal;
const minutes = document.getElementById('minutes') as HTMLInputElement;
const domains = document.getElementById('domains') as HTMLTextAreaElement;
const saved = document.getElementById('saved') as HTMLSpanElement;
const engines = document.getElementById('engines') as HTMLDivElement;
const recmode = document.getElementById('recmode') as HTMLDivElement;
const rechelp = document.getElementById('rechelp') as HTMLParagraphElement;
const mic = document.getElementById('mic') as HTMLSelectElement;
const michelp = document.getElementById('michelp') as HTMLParagraphElement;
const micUnlock = document.getElementById('mic-unlock') as HTMLButtonElement;
const recdir = document.getElementById('recdir') as HTMLSpanElement;
const dldir = document.getElementById('dldir') as HTMLSpanElement;

let current: Prefs = {
  focusMinutes: 25, blockedDomains: [], searchEngine: 'google', recordMode: 'glass',
  micLabel: '', recordDir: '', downloadDir: '',
};
let timer: number | undefined;
let savedTimer: number | undefined;

function read(): Prefs {
  return {
    searchEngine: current.searchEngine,
    recordMode: current.recordMode,
    micLabel: current.micLabel,
    recordDir: current.recordDir,
    downloadDir: current.downloadDir,
    focusMinutes: Math.max(1, Math.min(600, Number(minutes.value) || current.focusMinutes)),
    blockedDomains: domains.value.split(/\r?\n/).map((d) => d.trim()).filter(Boolean),
  };
}

function flash() {
  saved.classList.add('on');
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => saved.classList.remove('on'), 1200);
}

function save() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = read();
    api.setPrefs(current);
    flash();
  }, 300);
}

function renderEngines(list: { key: Prefs['searchEngine']; label: string }[]) {
  engines.replaceChildren(...list.map(({ key, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice' + (key === current.searchEngine ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      current.searchEngine = key;
      api.setPrefs({ searchEngine: key });
      renderEngines(list);
      flash();
    });
    return b;
  }));
}

minutes.addEventListener('input', save);
domains.addEventListener('input', save);
domains.addEventListener('blur', () => {
  // tidy the list once the user is done typing
  void api.getPrefs().then((p) => { domains.value = p.blockedDomains.join('\n'); });
});

function renderRecMode(ffmpeg: boolean) {
  const options: { key: Prefs['recordMode']; label: string }[] = [
    { key: 'glass', label: 'Glass' },
    { key: 'window', label: 'Window only' },
  ];
  recmode.replaceChildren(...options.map(({ key, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice' + (key === current.recordMode ? ' on' : '');
    b.textContent = label;
    b.disabled = key === 'glass' && !ffmpeg;
    b.addEventListener('click', () => {
      current.recordMode = key;
      api.setPrefs({ recordMode: key });
      renderRecMode(ffmpeg);
      flash();
    });
    return b;
  }));
  if (!ffmpeg) rechelp.textContent = 'Recordings land in ~/Movies/Slate. Glass mode needs ffmpeg (brew install ffmpeg); until then the window is captured on its own.';
}

async function renderMics(unlock = false) {
  const labels = await api.micDevices(unlock);
  const opts: { value: string; text: string }[] = [{ value: '', text: 'System default microphone' }];
  for (const l of labels) opts.push({ value: l, text: l });
  if (current.micLabel && !labels.includes(current.micLabel)) {
    opts.push({ value: current.micLabel, text: `${current.micLabel} (not connected)` });
  }
  mic.replaceChildren(...opts.map(({ value, text }) => {
    const o = document.createElement('option');
    o.value = value; o.textContent = text; o.selected = value === current.micLabel;
    return o;
  }));
  micUnlock.hidden = labels.length > 0;
  michelp.textContent = labels.length > 0
    ? 'Microphone used by ⌘⌥⇧R.'
    : 'Microphone used by ⌘⌥⇧R. Device names appear once Slate has microphone access.';
}
micUnlock.addEventListener('click', () => void renderMics(true));
mic.addEventListener('change', () => {
  current.micLabel = mic.value;
  api.setPrefs({ micLabel: mic.value });
  flash();
});

async function renderDirs() {
  const d = await api.dirs();
  recdir.textContent = d.recordDir;
  dldir.textContent = d.downloadDir;
  recdir.title = d.recordDir;
  dldir.title = d.downloadDir;
}
for (const [key, chooseId, resetId] of [['recordDir', 'recdir-choose', 'recdir-reset'], ['downloadDir', 'dldir-choose', 'dldir-reset']] as const) {
  document.getElementById(chooseId)?.addEventListener('click', async () => {
    const chosen = await api.chooseDir(key);
    if (chosen) { current[key] = chosen; await renderDirs(); flash(); }
  });
  document.getElementById(resetId)?.addEventListener('click', async () => {
    current[key] = '';
    api.setPrefs({ [key]: '' });
    await renderDirs();
    flash();
  });
}

void Promise.all([api.getPrefs(), api.searchEngines(), api.hasFfmpeg()]).then(async ([p, list, ffmpeg]) => {
  current = p;
  minutes.value = String(p.focusMinutes);
  domains.value = p.blockedDomains.join('\n');
  renderEngines(list);
  renderRecMode(ffmpeg);
  await renderMics();
  await renderDirs();
  window.addEventListener('focus', () => void renderMics());
});
