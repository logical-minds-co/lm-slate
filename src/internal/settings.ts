import './internal.css';
import type { Prefs } from '../shared/types';

const api = window.slateInternal;
const minutes = document.getElementById('minutes') as HTMLInputElement;
const domains = document.getElementById('domains') as HTMLTextAreaElement;
const saved = document.getElementById('saved') as HTMLSpanElement;
const engines = document.getElementById('engines') as HTMLDivElement;
const recmode = document.getElementById('recmode') as HTMLDivElement;
const rechelp = document.getElementById('rechelp') as HTMLParagraphElement;

let current: Prefs = { focusMinutes: 25, blockedDomains: [], searchEngine: 'google', recordMode: 'glass' };
let timer: number | undefined;
let savedTimer: number | undefined;

function read(): Prefs {
  return {
    searchEngine: current.searchEngine,
    recordMode: current.recordMode,
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

void Promise.all([api.getPrefs(), api.searchEngines(), api.hasFfmpeg()]).then(([p, list, ffmpeg]) => {
  current = p;
  minutes.value = String(p.focusMinutes);
  domains.value = p.blockedDomains.join('\n');
  renderEngines(list);
  renderRecMode(ffmpeg);
});
