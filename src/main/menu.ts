import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { TabManager } from './tabs';
import { SEARCH_ENGINES, type SearchEngine } from '../shared/search';

export interface MenuActions {
  togglePalette: () => void;
  focus: () => void;
  settings: () => void;
  overview: () => void;
  record: () => void;
}

export function buildMenu(tabs: () => TabManager | undefined, searchEngine: SearchEngine, actions: MenuActions) {
  const t = (fn: (m: TabManager) => void) => () => { const m = tabs(); if (m) fn(m); };

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [
          { role: 'about' as const },
          { type: 'separator' as const },
          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: actions.settings },
          { type: 'separator' as const },
          { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ] }]
      : []),
    {
      label: 'Tab',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: actions.togglePalette },
        { label: 'Command Palette ', accelerator: 'CmdOrCtrl+P', visible: false, click: actions.togglePalette },
        { label: 'Overview', accelerator: 'CmdOrCtrl+Shift+O', click: actions.overview },
        { type: 'separator' },
        { label: 'Focus on a Task…', accelerator: 'CmdOrCtrl+Shift+F', click: actions.focus },
        { label: 'End Focus Session', click: t((m) => m.stopFocus()) },
        { type: 'separator' },
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+N', click: t((m) => m.newTab('terminal')) },
        { label: 'New Browser', accelerator: 'CmdOrCtrl+T', click: t((m) => m.newTab('browser')) },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: t((m) => m.closeTab()) },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: t((m) => m.cycle(1)) },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: t((m) => m.cycle(-1)) },
        { label: 'Next Tab ', accelerator: 'CmdOrCtrl+Shift+]', click: t((m) => m.cycle(1)) },
        { label: 'Previous Tab ', accelerator: 'CmdOrCtrl+Shift+[', click: t((m) => m.cycle(-1)) },
        { label: 'Next Tab  ', accelerator: 'CmdOrCtrl+Alt+Right', visible: false, click: t((m) => m.cycle(1)) },
        { label: 'Previous Tab  ', accelerator: 'CmdOrCtrl+Alt+Left', visible: false, click: t((m) => m.cycle(-1)) },
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: `Tab ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, visible: false,
          click: t((m) => m.activateIndex(i)),
        })),
      ],
    },
    {
      label: 'Browse',
      submenu: [
        { label: 'Open Location', accelerator: 'CmdOrCtrl+L', click: t((m) => m.focusUrl()) },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: t((m) => m.reload()) },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: t((m) => m.back()) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: t((m) => m.forward()) },
        { label: 'Open Page in Default Browser', accelerator: 'CmdOrCtrl+Shift+E', click: t((m) => m.openExternal()) },
        { type: 'separator' },
        {
          label: 'Search Engine',
          submenu: (Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((key): MenuItemConstructorOptions => ({
            label: SEARCH_ENGINES[key].label,
            type: 'radio',
            checked: key === searchEngine,
            click: t((m) => m.setSearchEngine(key)),
          })),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Light / Dark', accelerator: 'CmdOrCtrl+Shift+D', click: t((m) => m.toggleTheme()) },
        { label: 'Toggle Frosted / Clear Glass', accelerator: 'CmdOrCtrl+Shift+G', click: t((m) => m.toggleClear()) },
        { type: 'separator' },
        { label: 'Start / Stop Screen Recording', accelerator: 'CmdOrCtrl+Shift+R', click: actions.record },
        ...(process.platform !== 'darwin' ? [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: actions.settings }] : []),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
