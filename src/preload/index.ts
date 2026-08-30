import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, RecStartOptions, SlateApi, TabKind } from '../shared/types';
import type { SearchEngine } from '../shared/search';
import type { PalettePayload } from '../shared/palette';
import type { OverviewPayload } from '../shared/overview';

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: SlateApi = {
  getState: () => ipcRenderer.invoke('state:get') as Promise<AppState>,
  onState: (cb) => subscribe<[AppState]>('state', cb),
  onPtyData: (cb) => subscribe<[string, string]>('pty:data', cb),
  onPtyExit: (cb) => subscribe<[string]>('pty:exit', cb),
  onFocusUrl: (cb) => subscribe<[]>('ui:focus-url', cb),
  onPeek: (cb) => subscribe<[]>('ui:peek', cb),
  onOverview: (cb) => subscribe<[boolean]>('ui:overview', cb),
  onSnapshotRequest: (cb) => subscribe<[]>('snapshots:request', cb),
  sendSnapshots: (snapshots) => ipcRenderer.send('snapshots:reply', snapshots),
  onRecStart: (cb) => subscribe<[RecStartOptions]>('rec:start', cb),
  onRecStop: (cb) => subscribe<[]>('rec:stop', cb),
  recSource: () => ipcRenderer.invoke('rec:source') as Promise<string>,
  recChunk: (chunk) => ipcRenderer.send('rec:chunk', chunk),
  recStarted: (mimeType: string) => ipcRenderer.send('rec:started', mimeType),
  onMicRequest: (cb) => subscribe<[boolean]>('mics:request', cb),
  sendMics: (labels) => ipcRenderer.send('mics:reply', labels),
  recDone: (error?: string) => ipcRenderer.send('rec:done', error),
  onModifier: (cb) => subscribe<[boolean]>('ui:modifier', cb),

  newTab: (kind: TabKind, url?: string) => ipcRenderer.send('tabs:new', kind, url),
  closeTab: (id) => ipcRenderer.send('tabs:close', id),
  activate: (id) => ipcRenderer.send('tabs:activate', id),
  setTitle: (id, title) => ipcRenderer.send('tabs:title', id, title),

  navigate: (id, input) => ipcRenderer.send('browser:navigate', id, input),
  back: (id) => ipcRenderer.send('browser:back', id),
  forward: (id) => ipcRenderer.send('browser:forward', id),
  reload: (id) => ipcRenderer.send('browser:reload', id),
  clearTab: (id) => ipcRenderer.send('browser:clear', id),
  setSearchEngine: (engine: SearchEngine) => ipcRenderer.send('search:engine', engine),

  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),

  toggleTheme: () => ipcRenderer.send('theme:toggle'),
  toggleClear: () => ipcRenderer.send('glass:toggle'),
  startFocus: (task, minutes) => ipcRenderer.send('focus:start', task, minutes),
  stopFocus: () => ipcRenderer.send('focus:stop'),
  toggleRecording: () => ipcRenderer.send('rec:toggle'),
  startRecordingWithMic: () => ipcRenderer.send('rec:start-mic'),

  onPaletteOpen: (cb) => subscribe<[PalettePayload]>('palette:open', cb),
  onPaletteClose: (cb) => subscribe<[]>('palette:close', cb),
  onOverviewOpen: (cb) => subscribe<[OverviewPayload]>('overview:open', cb),
  onCountdown: (cb) => subscribe<[number, boolean]>('countdown:start', cb),
  paletteRun: (action) => ipcRenderer.send('palette:run', action),
  paletteClose: () => ipcRenderer.send('palette:close'),
};

contextBridge.exposeInMainWorld('slate', api);
