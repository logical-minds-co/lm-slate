import type { FocusSession, TabInfo } from './types';
import type { SearchEngine } from './search';

/** What the palette needs to build its list. */
export interface PalettePayload {
  tabs: TabInfo[];
  activeId: string | null;
  dark: boolean;
  clear: boolean;
  searchEngine: SearchEngine;
  focus: FocusSession | null;
  focusMinutes: number;
  recording: boolean;
  /** 'focus' opens straight into the task/minutes prompt (⌘⇧F). */
  mode?: 'list' | 'focus';
}

/**
 * Actions the palette can ask the main process to run:
 *   tab:<id>         activate a slate
 *   close:<id>       close a slate
 *   cmd:<name>       one of the commands below
 *   engine:<key>     pick a search engine
 *   go:<text>        open text as address / search
 *   focus:<min>:<task>  start a focus session
 */
export type PaletteAction = string;

export const COMMANDS = [
  { id: 'new-terminal', label: 'New terminal', keys: '⌘N' },
  { id: 'new-browser', label: 'New browser', keys: '⌘T' },
  { id: 'close', label: 'Close slate', keys: '⌘W' },
  { id: 'focus', label: 'Focus on a task…', keys: '⌘⇧F' },
  { id: 'focus-stop', label: 'End focus session', focusOnly: true },
  { id: 'settings', label: 'Settings', keys: '⌘,' },
  { id: 'overview', label: 'Overview of all slates', keys: '⌘⇧O' },
  { id: 'record', label: 'Start screen recording', keys: '⌘⇧R' },
  { id: 'theme', label: 'Toggle light / dark ink', keys: '⌘⇧D' },
  { id: 'glass', label: 'Toggle frosted / clear glass', keys: '⌘⇧G' },
  { id: 'reload', label: 'Reload page', keys: '⌘R', browser: true },
  { id: 'external', label: 'Open page in default browser', keys: '⌘⇧E', browser: true },
  { id: 'back', label: 'Back', keys: '⌘[', browser: true },
  { id: 'forward', label: 'Forward', keys: '⌘]', browser: true },
] as const;

export type CommandId = (typeof COMMANDS)[number]['id'];
