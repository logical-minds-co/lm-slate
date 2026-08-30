import type { SearchEngine } from './search';
import type { PalettePayload } from './palette';
import type { OverviewPayload } from './overview';

export type TabKind = 'terminal' | 'browser';

export interface TabInfo {
  id: string;
  kind: TabKind;
  title: string;
  url?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

export interface FocusSession {
  task: string;
  minutes: number;
  startedAt: number;
  endsAt: number;
}

/** User preferences editable from slate://settings */
export type RecordMode = 'glass' | 'window';

export interface Prefs {
  focusMinutes: number;
  blockedDomains: string[];
  searchEngine: SearchEngine;
  /** glass = capture the screen and crop to the window (true frosted look, needs ffmpeg); window = isolated window capture */
  recordMode: RecordMode;
}

export interface RecStartOptions {
  mode: RecordMode;
  /** Mix the default microphone into the recording (walkthroughs). */
  mic: boolean;
}

export interface RecordingState {
  startedAt: number;
  file: string;
  mic: boolean;
}

export interface AppState {
  tabs: TabInfo[];
  activeId: string | null;
  dark: boolean;
  /** true = no native blur behind the window, just see-through glass */
  clear: boolean;
  searchEngine: SearchEngine;
  focus: FocusSession | null;
  /** Task name of a session that just finished (shown briefly). */
  focusDone: string | null;
  recording: RecordingState | null;
}

/** Height of the top bar, in CSS px. Browser views are laid out below it. */
export const TOP_BAR_HEIGHT = 40;

export interface SlateApi {
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): () => void;
  onPtyData(cb: (id: string, data: string) => void): () => void;
  onPtyExit(cb: (id: string) => void): () => void;
  onFocusUrl(cb: () => void): () => void;
  /** Fired after a tab is created/switched: reveal the tab row briefly. */
  onPeek(cb: () => void): () => void;
  /** Overview open/closed: the renderer hides its own terminals while the mosaic is up. */
  onOverview(cb: (open: boolean) => void): () => void;
  /** Main asks for terminal text snapshots (for the mosaic). */
  onSnapshotRequest(cb: () => void): () => void;
  sendSnapshots(snapshots: Record<string, { lines: string[]; cols: number; rows: number }>): void;
  /** Screen recording, driven by main; the renderer owns the MediaRecorder. */
  onRecStart(cb: (opts: RecStartOptions) => void): () => void;
  onRecStop(cb: () => void): () => void;
  recSource(): Promise<string>;
  recChunk(chunk: ArrayBuffer): void;
  recStarted(mimeType: string): void;
  recDone(error?: string): void;
  /** Control key held/released while focus is inside a browser page. */
  onModifier(cb: (held: boolean) => void): () => void;

  newTab(kind: TabKind, url?: string): void;
  closeTab(id: string): void;
  activate(id: string): void;
  setTitle(id: string, title: string): void;

  navigate(id: string, input: string): void;
  back(id: string): void;
  forward(id: string): void;
  reload(id: string): void;
  clearTab(id: string): void;
  setSearchEngine(engine: SearchEngine): void;

  ptyWrite(id: string, data: string): void;
  ptyResize(id: string, cols: number, rows: number): void;

  toggleTheme(): void;
  toggleClear(): void;
  startFocus(task: string, minutes: number): void;
  stopFocus(): void;
  toggleRecording(): void;
  startRecordingWithMic(): void;

  // palette page only
  onPaletteOpen(cb: (payload: PalettePayload) => void): () => void;
  onPaletteClose(cb: () => void): () => void;
  onOverviewOpen(cb: (payload: OverviewPayload) => void): () => void;
  onCountdown(cb: (seconds: number, dark: boolean) => void): () => void;
  paletteRun(action: string): void;
  paletteClose(): void;
}

/** Exposed only to slate:// pages (settings, blocked). */
export interface SlateInternalApi {
  getPrefs(): Promise<Prefs>;
  setPrefs(prefs: Partial<Prefs>): void;
  searchEngines(): Promise<{ key: SearchEngine; label: string }[]>;
  hasFfmpeg(): Promise<boolean>;
  getFocus(): Promise<FocusSession | null>;
  stopFocus(): void;
}

declare global {
  interface Window {
    slate: SlateApi;
    slateInternal: SlateInternalApi;
  }
}
