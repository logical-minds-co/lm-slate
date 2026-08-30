import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FocusSession, RecordMode, TabKind } from '../shared/types';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, type SearchEngine } from '../shared/search';

export interface PersistedTab {
  kind: TabKind;
  url?: string;
}

export interface Settings {
  dark: boolean;
  clear: boolean;
  searchEngine: SearchEngine;
  tabs: PersistedTab[];
  activeIndex: number;
  focus: FocusSession | null;
  focusMinutes: number;
  blockedDomains: string[];
  recordMode: RecordMode;
}

const defaults: Settings = {
  dark: false, clear: false, searchEngine: DEFAULT_SEARCH_ENGINE, tabs: [], activeIndex: -1,
  focus: null, focusMinutes: 25, blockedDomains: [], recordMode: 'glass',
};

function file() {
  return join(app.getPath('userData'), 'slate.json');
}

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>;
    const merged = { ...defaults, ...raw };
    if (!(merged.searchEngine in SEARCH_ENGINES)) merged.searchEngine = DEFAULT_SEARCH_ENGINE;
    return merged;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('slate: could not read settings', err);
    return { ...defaults };
  }
}

let timer: NodeJS.Timeout | null = null;
export function saveSettings(s: Settings, immediate = false) {
  if (timer) clearTimeout(timer);
  const write = () => {
    timer = null;
    try {
      mkdirSync(app.getPath('userData'), { recursive: true });
      writeFileSync(file(), JSON.stringify(s, null, 2));
    } catch (err) {
      console.error('slate: failed to save settings', err);
    }
  };
  if (immediate) write();
  else timer = setTimeout(write, 250);
}
