import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { GLASS_MATERIAL, TabManager } from './tabs';
import { buildMenu } from './menu';
import { Palette } from './palette';
import { Overview, type TerminalSnapshot } from './overview';
import { Recorder, findFfmpeg } from './recorder';
import { installDownloads } from './downloads';
import { installBlocking } from './focus';
import type { Prefs } from '../shared/types';
import type { TabKind } from '../shared/types';
import { SEARCH_ENGINES, type SearchEngine } from '../shared/search';

let win: BrowserWindow | null = null;
let tabs: TabManager | null = null;
let palette: Palette | null = null;
let overview: Overview | null = null;
let recorder: Recorder | null = null;

const refreshMenu = () => buildMenu(() => tabs ?? undefined, tabs?.searchEngine ?? 'google', {
  togglePalette: () => palette?.toggle(),
  focus: () => palette?.open('focus'),
  settings: () => tabs?.openInternal('slate://settings/'),
  overview: () => overview?.toggle(),
  record: () => recorder?.toggle(),
  recordMic: () => void recorder?.start(true),
});

/** slate://settings/, slate://blocked/ — internal pages served from dist/internal. */
function serveInternalPages() {
  protocol.handle('slate', (req) => {
    const u = new URL(req.url);
    const file = (u.pathname === '/' ? `${u.hostname}.html` : u.pathname.slice(1)).replace(/[^a-z0-9._-]/gi, '');
    return net.fetch(pathToFileURL(join(__dirname, 'internal', file)).toString());
  });
}

const isInternal = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!e.senderFrame?.url.startsWith('slate://');

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 480,
    minHeight: 320,
    show: false,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    transparent: true,
    backgroundColor: '#00000000',
    vibrancy: GLASS_MATERIAL,
    visualEffectState: 'active',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  tabs = new TabManager(win);
  palette = new Palette(win, tabs, {
    onEngineChange: refreshMenu,
    openOverview: () => void overview?.open(),
    pickOverview: (id) => overview?.pick(id),
    toggleRecording: () => recorder?.toggle(),
    startRecordingWithMic: () => void recorder?.start(true),
  });
  overview = new Overview(win, tabs, palette);
  tabs.onBeforeSwitch = () => palette?.dismiss();
  recorder = new Recorder(
    win, tabs,
    (seconds) => palette?.countdown(seconds) ?? Promise.resolve(true),
    () => palette?.close(),
    () => palette?.countingDown ?? false,
  );
  recorder.install();
  refreshMenu();
  win.once('ready-to-show', () => {
    win?.show();
    tabs?.restore();
    runDevHook();
  });
  win.on('closed', () => {
    tabs?.dispose();
    tabs = null;
    palette = null;
    overview = null;
    recorder = null;
    win = null;
  });

  void win.loadFile(join(__dirname, 'index.html'));
}

function wire() {
  const m = () => tabs;
  ipcMain.handle('state:get', () => m()?.state());
  ipcMain.on('tabs:new', (_e, kind: TabKind, url?: string) => m()?.newTab(kind, url));
  ipcMain.on('tabs:close', (_e, id: string) => m()?.closeTab(id));
  ipcMain.on('tabs:activate', (_e, id: string) => m()?.activate(id));
  ipcMain.on('tabs:title', (_e, id: string, title: string) => m()?.setTitle(id, title));
  ipcMain.on('browser:navigate', (_e, id: string, input: string) => m()?.navigate(id, input));
  ipcMain.on('browser:back', (_e, id: string) => m()?.back(id));
  ipcMain.on('browser:forward', (_e, id: string) => m()?.forward(id));
  ipcMain.on('browser:reload', (_e, id: string) => m()?.reload(id));
  ipcMain.on('pty:write', (_e, id: string, data: string) => m()?.ptyWrite(id, data));
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => m()?.ptyResize(id, cols, rows));
  ipcMain.on('theme:toggle', () => m()?.toggleTheme());
  ipcMain.on('glass:toggle', () => m()?.toggleClear());
  ipcMain.on('browser:clear', (_e, id: string) => m()?.clearTab(id));
  ipcMain.on('search:engine', (_e, engine: SearchEngine) => { m()?.setSearchEngine(engine); refreshMenu(); });
  ipcMain.on('palette:run', (_e, action: string) => palette?.run(action));
  ipcMain.on('palette:close', () => palette?.close());
  ipcMain.on('snapshots:reply', (_e, snaps: Record<string, TerminalSnapshot>) => overview?.receiveSnapshots(snaps));
  ipcMain.on('rec:toggle', () => recorder?.toggle());
  ipcMain.on('rec:start-mic', () => void recorder?.start(true));
  ipcMain.handle('rec:source', () => recorder?.sourceId());
  ipcMain.on('rec:chunk', (_e, buf: ArrayBuffer) => recorder?.chunk(buf));
  ipcMain.on('rec:started', (_e, mimeType: string) => recorder?.started(mimeType));
  ipcMain.on('rec:done', (_e, error?: string) => recorder?.done(error));
  ipcMain.on('focus:start', (_e, task: string, minutes: number) => m()?.startFocus(task, minutes));
  ipcMain.on('focus:stop', () => m()?.stopFocus());
  ipcMain.handle('internal:prefs:get', (e) => (isInternal(e) ? m()?.prefs : null));
  ipcMain.on('internal:prefs:set', (e, prefs: Partial<Prefs>) => { if (isInternal(e)) { m()?.setPrefs(prefs); refreshMenu(); } });
  ipcMain.handle('internal:ffmpeg', (e) => (isInternal(e) ? !!findFfmpeg() : false));
  ipcMain.handle('internal:dirs', (e) => (isInternal(e) ? m()?.dirs : null));
  ipcMain.handle('internal:mics', (e, unlock: boolean) => {
    const w = win;
    if (!isInternal(e) || !w) return [];
    return new Promise<string[]>((resolve) => {
      const timer = setTimeout(() => { ipcMain.removeListener('mics:reply', onReply); resolve([]); }, unlock ? 30_000 : 3000);
      const onReply = (_ev: Electron.IpcMainEvent, labels: string[]) => { clearTimeout(timer); resolve(Array.isArray(labels) ? labels : []); };
      ipcMain.once('mics:reply', onReply);
      w.webContents.send('mics:request', !!unlock);
    });
  });
  ipcMain.handle('internal:choose-dir', async (e, key: 'recordDir' | 'downloadDir') => {
    if (!isInternal(e) || !win || !tabs || (key !== 'recordDir' && key !== 'downloadDir')) return null;
    const r = await dialog.showOpenDialog(win, {
      title: key === 'recordDir' ? 'Recordings folder' : 'Downloads folder',
      defaultPath: tabs.dirs[key],
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    tabs.setPrefs({ [key]: r.filePaths[0] });
    return r.filePaths[0];
  });
  ipcMain.handle('internal:engines', (e) => (isInternal(e)
    ? (Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((key) => ({ key, label: SEARCH_ENGINES[key].label }))
    : []));
  ipcMain.handle('internal:focus:get', (e) => (isInternal(e) ? m()?.focus ?? null : null));
  nativeTheme.on('updated', () => m()?.refresh());
}

/** SLATE_TEST=overview|record drives a feature without keyboard input (used by automated checks). */
function runDevHook() {
  const t = process.env.SLATE_TEST;
  if (!t) return;
  if (t === 'overview') setTimeout(() => void overview?.open(), 3000);
  if (t === 'overview-newtab') {
    setTimeout(() => void overview?.open(), 3000);
    setTimeout(() => tabs?.newTab('browser'), 6000);
  }
  if (t === 'fill') setTimeout(() => { const a = tabs?.active; if (a?.kind === 'terminal') tabs?.ptyWrite(a.id, 'seq 1 400\n'); }, 3000);
  if (t === 'fit') setTimeout(() => { for (const b of tabs?.browserViews() ?? []) b.view.webContents.setZoomFactor(0.6); }, 3000);
  if (t === 'record') {
    setTimeout(() => void recorder?.start(process.env.SLATE_TEST_MIC === '1'), 2000);
    setTimeout(() => recorder?.stop(), 7000 + Recorder.COUNTDOWN_SECONDS * 1000);
  }
}

app.setName('Slate');
protocol.registerSchemesAsPrivileged([
  { scheme: 'slate', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  // In development the binary is plain Electron; give the Dock our icon anyway. Packaged builds use build/icon.icns.
  if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '..', 'assets', 'icon.png'));
  serveInternalPages();
  installBlocking(() => tabs);
  installDownloads(() => tabs);
  wire();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => tabs?.flush());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
