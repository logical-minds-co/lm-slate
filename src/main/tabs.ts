import { BrowserWindow, WebContentsView, nativeTheme, shell, type View } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TOP_BAR_HEIGHT, type AppState, type TabInfo, type TabKind } from '../shared/types';
import { spawnShell, type PtyHandle } from './pty';
import { loadSettings, resolveDirs, saveSettings, type Settings } from './settings';
import { SEARCH_ENGINES, type SearchEngine } from '../shared/search';
import type { FocusSession, Prefs } from '../shared/types';
import { BLOCKED_URL, hostMatches, normaliseDomain, notifyDone } from './focus';

/** macOS material used for the frosted look. 'menu' is the most see-through of the theme-aware ones. */
export const GLASS_MATERIAL = (process.env.SLATE_VIBRANCY ?? 'menu') as NonNullable<Parameters<BrowserWindow['setVibrancy']>[0]>;
const BLANK = 'about:blank';

interface TerminalTab extends TabInfo { kind: 'terminal'; pty: PtyHandle }
interface BrowserTab extends TabInfo { kind: 'browser'; view: WebContentsView }
type Tab = TerminalTab | BrowserTab;

/** Turns whatever the user typed into a URL: scheme-less hosts get https, everything else becomes a search. */
export function toUrl(input: string, engine: SearchEngine): string {
  const s = input.trim();
  if (!s) return BLANK;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  if (s === 'localhost' || /^localhost[:/]/.test(s)) return `http://${s}`;
  if (!/\s/.test(s) && /^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(s)) return `https://${s}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s)) return `http://${s}`;
  return SEARCH_ENGINES[engine].url + encodeURIComponent(s);
}

export class TabManager {
  private tabs: Tab[] = [];
  private activeId: string | null = null;
  private settings: Settings;
  private restored = false;
  private overlay: View | null = null;
  private focusTimer: NodeJS.Timeout | null = null;
  private focusDone: string | null = null;
  private focusDoneTimer: NodeJS.Timeout | null = null;

  constructor(private win: BrowserWindow) {
    this.settings = loadSettings();
    nativeTheme.themeSource = this.settings.dark ? 'dark' : 'light';
    this.applyGlass();
    if (this.settings.focus) this.armFocusTimer();
    win.on('resize', () => this.layout());
    win.webContents.on('did-finish-load', () => this.push());
  }

  /** A view that must always stay above the browser views (the command palette). */
  setOverlay(view: View) {
    this.overlay = view;
  }

  /** Called before any tab change so an open overlay (overview, palette) gets out of the way. */
  onBeforeSwitch: (() => void) | null = null;

  /** Recreates the previous session's tabs (terminals come back as fresh shells). */
  restore() {
    const { tabs, activeIndex } = this.settings;
    this.restored = true;
    if (tabs.length === 0) {
      this.newTab('terminal');
      return;
    }
    for (const t of tabs) this.newTab(t.kind, t.url, false);
    const target = this.tabs[activeIndex] ?? this.tabs[0];
    if (target) this.activate(target.id);
  }

  /** Write the session to disk immediately (used on quit). */
  flush() {
    if (this.restored) saveSettings(this.settings, true);
  }

  state(): AppState {
    return {
      tabs: this.tabs.map(({ id, kind, title, url, loading, canGoBack, canGoForward }) => ({
        id, kind, title, url, loading, canGoBack, canGoForward,
      })),
      activeId: this.activeId,
      dark: nativeTheme.shouldUseDarkColors,
      clear: this.settings.clear,
      searchEngine: this.settings.searchEngine,
      focus: this.settings.focus,
      focusDone: this.focusDone,
      recording: this.recording,
    };
  }

  recording: import('../shared/types').RecordingState | null = null;

  setRecording(r: import('../shared/types').RecordingState | null) {
    this.recording = r;
    this.push();
  }

  /** Browser tabs with their live views — used by the overview to tile them. */
  browserViews(): { id: string; view: WebContentsView; url: string }[] {
    return this.tabs.filter((t): t is BrowserTab => t.kind === 'browser').map((t) => ({ id: t.id, view: t.view, url: t.url ?? BLANK }));
  }

  terminalInfo(): { id: string; title: string }[] {
    return this.tabs.filter((t) => t.kind === 'terminal').map((t) => ({ id: t.id, title: t.title }));
  }

  contentBounds() {
    const [w, h] = this.win.getContentSize();
    return { x: 0, y: TOP_BAR_HEIGHT, width: w, height: Math.max(0, h - TOP_BAR_HEIGHT) };
  }

  // ─── focus sessions ──────────────────────────────────────────

  get prefs(): Prefs {
    return {
      focusMinutes: this.settings.focusMinutes,
      blockedDomains: this.settings.blockedDomains,
      searchEngine: this.settings.searchEngine,
      recordMode: this.settings.recordMode,
      micLabel: this.settings.micLabel,
      recordDir: this.settings.recordDir,
      downloadDir: this.settings.downloadDir,
    };
  }

  get dirs() {
    return resolveDirs(this.settings);
  }

  setPrefs(p: Partial<Prefs>) {
    if (typeof p.focusMinutes === 'number' && p.focusMinutes >= 1 && p.focusMinutes <= 600) {
      this.settings.focusMinutes = Math.round(p.focusMinutes);
    }
    if (p.searchEngine && p.searchEngine in SEARCH_ENGINES) this.settings.searchEngine = p.searchEngine;
    if (p.recordMode === 'glass' || p.recordMode === 'window') this.settings.recordMode = p.recordMode;
    if (typeof p.micLabel === 'string') this.settings.micLabel = p.micLabel.slice(0, 200);
    if (typeof p.recordDir === 'string') this.settings.recordDir = p.recordDir;
    if (typeof p.downloadDir === 'string') this.settings.downloadDir = p.downloadDir;
    if (Array.isArray(p.blockedDomains)) {
      const clean = p.blockedDomains.map((d) => normaliseDomain(String(d))).filter((d): d is string => !!d);
      this.settings.blockedDomains = [...new Set(clean)];
    }
    this.redirectBlockedTabs();
    this.push();
  }

  get focus(): FocusSession | null {
    return this.settings.focus;
  }

  focusActive(): boolean {
    return !!this.settings.focus && this.settings.focus.endsAt > Date.now();
  }

  isBlocked(host: string): boolean {
    return this.focusActive() && hostMatches(host, this.settings.blockedDomains);
  }

  startFocus(task: string, minutes = this.settings.focusMinutes) {
    const name = task.trim();
    const mins = Math.max(1, Math.min(600, Math.round(minutes) || this.settings.focusMinutes));
    if (!name) return;
    const now = Date.now();
    this.settings.focus = { task: name, minutes: mins, startedAt: now, endsAt: now + mins * 60_000 };
    this.focusDone = null;
    this.armFocusTimer();
    this.redirectBlockedTabs();
    this.push();
  }

  stopFocus() {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    this.focusTimer = null;
    this.settings.focus = null;
    this.push();
  }

  private armFocusTimer() {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    const f = this.settings.focus;
    if (!f) return;
    this.focusTimer = setTimeout(() => this.finishFocus(), Math.max(0, f.endsAt - Date.now()));
  }

  private finishFocus() {
    const f = this.settings.focus;
    if (!f) return;
    this.settings.focus = null;
    this.focusTimer = null;
    this.focusDone = f.task;
    notifyDone(f.task);
    if (this.focusDoneTimer) clearTimeout(this.focusDoneTimer);
    this.focusDoneTimer = setTimeout(() => { this.focusDone = null; this.push(); }, 12_000);
    this.push();
  }

  /** Tabs already sitting on a blocked domain get sent to the blocked page. */
  private redirectBlockedTabs() {
    if (!this.focusActive()) return;
    for (const t of this.tabs) {
      if (t.kind !== 'browser' || !t.url) continue;
      let host = '';
      try { host = new URL(t.url).hostname; } catch { continue; }
      if (host && this.isBlocked(host)) {
        void t.view.webContents.loadURL(`${BLOCKED_URL}?host=${encodeURIComponent(host)}&from=${encodeURIComponent(t.url)}`);
      }
    }
  }

  /** Open (or switch to) an internal page such as slate://settings/. */
  openInternal(url: string) {
    const existing = this.tabs.find((t) => t.kind === 'browser' && t.url?.startsWith(url));
    if (existing) this.activate(existing.id);
    else this.newTab('browser', url);
  }

  get searchEngine() {
    return this.settings.searchEngine;
  }

  setSearchEngine(engine: SearchEngine) {
    if (!(engine in SEARCH_ENGINES)) return;
    this.settings.searchEngine = engine;
    this.push();
  }

  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  newTab(kind: TabKind, url?: string, activate = true): Tab {
    if (activate) this.onBeforeSwitch?.();
    const id = randomUUID();
    const tab: Tab = kind === 'terminal' ? this.createTerminal(id) : this.createBrowser(id, url);
    const idx = this.active ? this.tabs.indexOf(this.active) + 1 : this.tabs.length;
    this.tabs.splice(idx, 0, tab);
    if (activate) this.activate(id);
    else this.push();
    return tab;
  }

  private createTerminal(id: string): TerminalTab {
    const pty = spawnShell(
      (data) => this.send('pty:data', id, data),
      () => {
        this.send('pty:exit', id);
        this.closeTab(id);
      },
    );
    return { id, kind: 'terminal', title: 'shell', pty };
  }

  private createBrowser(id: string, url?: string): BrowserTab {
    const view = new WebContentsView({
      webPreferences: { sandbox: true, contextIsolation: true, preload: join(__dirname, 'preload-internal.js') },
    });
    view.setBackgroundColor('#00000000');
    view.setVisible(false);
    this.win.contentView.addChildView(view);
    if (this.overlay) this.win.contentView.addChildView(this.overlay); // re-adding moves it to the top

    const tab: BrowserTab = { id, kind: 'browser', title: 'new', url: url ?? BLANK, view };
    const wc = view.webContents;
    const sync = () => {
      tab.url = wc.getURL();
      const t = wc.getTitle();
      tab.title = t && tab.url !== BLANK ? t : tab.url === BLANK ? 'new' : hostOf(tab.url);
      tab.loading = wc.isLoading();
      tab.canGoBack = wc.navigationHistory.canGoBack();
      tab.canGoForward = wc.navigationHistory.canGoForward();
      this.syncVisibility();
      this.push();
    };
    wc.on('page-title-updated', sync);
    wc.on('did-navigate', () => { if (!this.frozen) wc.setZoomFactor(1); });
    wc.on('did-start-loading', sync);
    wc.on('did-stop-loading', sync);
    wc.on('did-navigate', sync);
    wc.on('did-navigate-in-page', sync);
    wc.setWindowOpenHandler(({ url: target }) => {
      this.newTab('browser', target);
      return { action: 'deny' };
    });
    wc.on('before-input-event', (_e, input) => {
      // Escape inside a page returns focus to the top bar (URL entry).
      if (input.type === 'keyDown' && input.key === 'Escape' && !input.meta && !input.control) {
        this.focusUrl();
      }
      // Holding Control (the Ctrl+Tab modifier) reveals the tab row.
      if (input.key === 'Control') this.send('ui:modifier', input.type === 'keyDown');
    });
    wc.on('blur', () => this.send('ui:modifier', false));
    // A freshly created (still blank, hidden) view grabs keyboard focus; hand it back to the
    // renderer so the centered field actually receives what the user types.
    wc.on('focus', () => {
      if (tab.url === BLANK || this.activeId !== tab.id) this.focusActiveSlate();
    });
    wc.once('did-finish-load', () => {
      if (tab.url === BLANK && this.activeId === tab.id) this.focusActiveSlate();
    });

    void wc.loadURL(url ?? BLANK);
    return tab;
  }

  activate(id: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.onBeforeSwitch?.();
    this.activeId = id;
    this.syncVisibility();
    this.layout();
    if (tab.kind === 'browser' && tab.url !== BLANK) tab.view.webContents.focus();
    else this.win.webContents.focus(); // terminal, or the blank tab's centered field
    this.push();
    if (tab.kind === 'browser' && tab.url === BLANK) this.send('ui:focus-url');
    this.send('ui:peek');
  }

  /** Only the active browser tab is shown, and only once it has somewhere to be. */
  syncVisibility() {
    if (this.frozen) return;
    for (const t of this.tabs) {
      if (t.kind === 'browser') t.view.setVisible(t.id === this.activeId && t.url !== BLANK);
    }
  }

  /** Give keyboard focus back to whatever the active slate is. */
  focusActiveSlate() {
    const tab = this.active;
    if (tab?.kind === 'browser' && tab.url !== BLANK) {
      tab.view.webContents.focus();
    } else {
      this.win.webContents.focus();
      if (tab?.kind === 'browser') this.send('ui:focus-url');
    }
  }

  /** Open free text (address or search) — in the active blank tab if there is one, else a new one. */
  go(input: string) {
    const tab = this.active;
    if (tab?.kind === 'browser' && tab.url === BLANK) this.navigate(tab.id, input);
    else this.newTab('browser', toUrl(input, this.settings.searchEngine));
  }

  activateIndex(i: number) {
    const tab = this.tabs[i];
    if (tab) this.activate(tab.id);
  }

  cycle(delta: number) {
    if (this.tabs.length === 0) return;
    const i = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = (i + delta + this.tabs.length) % this.tabs.length;
    this.activate(this.tabs[next].id);
  }

  closeTab(id: string = this.activeId ?? '') {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.onBeforeSwitch?.();
    const [tab] = this.tabs.splice(i, 1);
    if (tab.kind === 'terminal') {
      tab.pty.kill();
    } else {
      this.win.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    }
    if (this.activeId === id) {
      const next = this.tabs[i] ?? this.tabs[i - 1];
      this.activeId = null;
      if (next) this.activate(next.id);
      else this.win.webContents.focus();
    }
    this.push();
  }

  setTitle(id: string, title: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab && tab.kind === 'terminal') {
      // zsh/oh-my-zsh report "user@host: ~/path" — keep just the interesting part
      const clean = title.replace(/^[\w.-]+@[\w.-]+:\s*/, '').trim();
      tab.title = clean || 'shell';
      this.push();
    }
  }

  navigate(id: string, input: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind !== 'browser') return;
    void tab.view.webContents.loadURL(toUrl(input, this.settings.searchEngine));
    tab.view.webContents.focus();
  }

  back(id = this.activeId ?? '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind === 'browser') tab.view.webContents.navigationHistory.goBack();
  }

  forward(id = this.activeId ?? '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind === 'browser') tab.view.webContents.navigationHistory.goForward();
  }

  /** Hand the active page to the system browser (for flows Slate can't serve, e.g. passkeys). */
  openExternal(id = this.activeId ?? '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind !== 'browser' || !tab.url || tab.url === BLANK || tab.url.startsWith('slate://')) return;
    void shell.openExternal(tab.url);
  }

  reload(id = this.activeId ?? '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind === 'browser') tab.view.webContents.reload();
  }

  /** ⌘L: edit the URL of the active browser tab, or open a fresh one if the active tab is a terminal. */
  focusUrl() {
    if (this.active?.kind !== 'browser') {
      this.newTab('browser');
      return;
    }
    this.win.webContents.focus();
    this.send('ui:focus-url');
  }

  /** Go back to the empty state of the active browser tab (⌘L from a page, then Esc). */
  clearTab(id = this.activeId ?? '') {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind !== 'browser') return;
    void tab.view.webContents.loadURL(BLANK);
    this.win.webContents.focus();
  }

  ptyWrite(id: string, data: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind === 'terminal') tab.pty.write(data);
  }

  ptyResize(id: string, cols: number, rows: number) {
    const tab = this.tabs.find((t) => t.id === id);
    if (tab?.kind === 'terminal') tab.pty.resize(cols, rows);
  }

  /** Re-broadcast state (e.g. after a native theme change). */
  refresh() {
    this.push();
  }

  toggleTheme() {
    nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark';
    this.push();
  }

  /** Frosted (native blur) ⇄ clear (fully see-through) glass. */
  toggleClear() {
    this.settings.clear = !this.settings.clear;
    this.applyGlass();
    this.push();
  }

  private applyGlass() {
    if (process.platform === 'darwin') this.win.setVibrancy(this.settings.clear ? null : GLASS_MATERIAL);
    else if (process.platform === 'win32') this.win.setBackgroundMaterial(this.settings.clear ? 'none' : 'acrylic');
  }

  layout() {
    if (this.frozen) return; // the overview owns the view geometry while it is open
    const bounds = this.contentBounds();
    for (const t of this.tabs) if (t.kind === 'browser') t.view.setBounds(bounds);
  }

  /** While true, layout()/syncVisibility() leave the views alone (overview mode). */
  frozen = false;

  private push() {
    const state = this.state();
    this.send('state', state);
    if (!this.restored) return; // don't clobber the saved session before it has been restored
    this.settings = {
      ...this.settings,
      dark: state.dark,
      tabs: this.tabs.map((t) => ({ kind: t.kind, url: t.kind === 'browser' ? t.url : undefined })),
      activeIndex: this.tabs.findIndex((t) => t.id === this.activeId),
    };
    saveSettings(this.settings);
  }

  private send(channel: string, ...args: unknown[]) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, ...args);
  }

  dispose() {
    for (const t of this.tabs) {
      if (t.kind === 'terminal') t.pty.kill();
      else t.view.webContents.close();
    }
    this.tabs = [];
  }
}

function hostOf(url: string) {
  try { return new URL(url).host || url; } catch { return url; }
}
