import { contextBridge, ipcRenderer } from 'electron';
import type { Prefs, SlateInternalApi } from '../shared/types';

// Only slate:// pages (settings, blocked) get an API; ordinary web pages get nothing.
if (location.protocol === 'slate:') {
  const api: SlateInternalApi = {
    getPrefs: () => ipcRenderer.invoke('internal:prefs:get'),
    setPrefs: (prefs: Partial<Prefs>) => ipcRenderer.send('internal:prefs:set', prefs),
    searchEngines: () => ipcRenderer.invoke('internal:engines'),
    hasFfmpeg: () => ipcRenderer.invoke('internal:ffmpeg'),
    getFocus: () => ipcRenderer.invoke('internal:focus:get'),
    stopFocus: () => ipcRenderer.send('focus:stop'),
  };
  contextBridge.exposeInMainWorld('slateInternal', api);
}
