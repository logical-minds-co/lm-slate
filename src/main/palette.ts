import { BrowserWindow, WebContentsView } from 'electron';
import { join } from 'node:path';
import type { TabManager } from './tabs';
import type { PalettePayload } from '../shared/palette';
import type { OverviewPayload } from '../shared/overview';
import type { SearchEngine } from '../shared/search';

/** The command palette: a transparent view laid over everything, shown on demand. */
export interface PaletteActions {
  onEngineChange: () => void;
  openOverview: () => void;
  pickOverview: (id: string) => void;
  toggleRecording: () => void;
}

export class Palette {
  readonly view: WebContentsView;
  private visible = false;
  private mode: 'palette' | 'overview' | null = null;
  /** Set by the Overview so it can put the views back when the overlay closes. */
  onOverviewClosed: (() => void) | null = null;

  constructor(private win: BrowserWindow, private tabs: TabManager, private actions: PaletteActions) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.view.setBackgroundColor('#00000000');
    this.view.setVisible(false);
    win.contentView.addChildView(this.view);
    tabs.setOverlay(this.view);
    void this.view.webContents.loadFile(join(__dirname, 'palette.html'));

    win.on('resize', () => this.layout());
    win.on('blur', () => this.close());
  }

  toggle() {
    if (this.mode === 'palette') this.close();
    else { this.close(); this.open(); }
  }

  open(mode: 'list' | 'focus' = 'list') {
    const s = this.tabs.state();
    const payload: PalettePayload = {
      tabs: s.tabs, activeId: s.activeId, dark: s.dark, clear: s.clear, searchEngine: s.searchEngine,
      focus: s.focus, focusMinutes: this.tabs.prefs.focusMinutes, recording: !!s.recording, mode,
    };
    this.show('palette');
    this.view.webContents.send('palette:open', payload);
  }

  showOverview(payload: OverviewPayload) {
    this.show('overview');
    this.view.webContents.send('overview:open', payload);
  }

  private show(mode: 'palette' | 'overview') {
    this.layout();
    this.view.setVisible(true);
    this.visible = true;
    this.mode = mode;
    this.view.webContents.focus();
  }

  close() {
    if (!this.visible) return;
    const mode = this.mode;
    this.visible = false;
    this.mode = null;
    this.view.setVisible(false);
    this.view.webContents.send('palette:close');
    if (mode === 'overview') this.onOverviewClosed?.();
    this.tabs.focusActiveSlate();
  }

  run(action: string) {
    this.close();
    const [kind, ...rest] = action.split(':');
    const arg = rest.join(':');
    switch (kind) {
      case 'tab': this.tabs.activate(arg); break;
      case 'pick': this.actions.pickOverview(arg); break;
      case 'close': this.tabs.closeTab(arg); break;
      case 'go': this.tabs.go(arg); break;
      case 'focus': {
        const [mins, ...task] = arg.split(':');
        this.tabs.startFocus(task.join(':'), Number(mins));
        break;
      }
      case 'engine':
        this.tabs.setSearchEngine(arg as SearchEngine);
        this.actions.onEngineChange();
        break;
      case 'cmd':
        switch (arg) {
          case 'new-terminal': this.tabs.newTab('terminal'); break;
          case 'new-browser': this.tabs.newTab('browser'); break;
          case 'close': this.tabs.closeTab(); break;
          case 'focus': this.open('focus'); break;
          case 'focus-stop': this.tabs.stopFocus(); break;
          case 'settings': this.tabs.openInternal('slate://settings/'); break;
          case 'overview': this.actions.openOverview(); break;
          case 'record': this.actions.toggleRecording(); break;
          case 'theme': this.tabs.toggleTheme(); break;
          case 'glass': this.tabs.toggleClear(); break;
          case 'reload': this.tabs.reload(); break;
          case 'external': this.tabs.openExternal(); break;
          case 'back': this.tabs.back(); break;
          case 'forward': this.tabs.forward(); break;
        }
        break;
    }
  }

  private layout() {
    const [width, height] = this.win.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }
}
