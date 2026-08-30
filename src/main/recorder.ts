import { app, BrowserWindow, desktopCapturer, nativeImage, Notification, screen, session, shell, systemPreferences, Tray } from 'electron';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, type WriteStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { delimiter } from 'node:path';
import { join } from 'node:path';
import type { TabManager } from './tabs';
import type { RecordingState, RecordMode } from '../shared/types';

/**
 * Records this window to a .webm in ~/Movies/Slate. The renderer owns the MediaRecorder
 * (it streams chunks here); main picks the capture source, writes the file and shows a
 * menu-bar indicator so nothing recording-related appears inside the recording itself.
 */
export class Recorder {
  private file: string | null = null;
  private starting = false;
  private stream: WriteStream | null = null;
  private state: RecordingState | null = null;
  private tray: Tray | null = null;
  private tick: NodeJS.Timeout | null = null;
  private mode: RecordMode = 'window';
  private mic = false;
  /** Window rectangle in physical screen pixels, captured at start (glass mode crops to it). */
  private crop: { x: number; y: number; w: number; h: number } | null = null;

  constructor(
    private win: BrowserWindow,
    private tabs: TabManager,
    /** Shows the on-glass countdown; resolves false when the user cancels. */
    private countdown: (seconds: number) => Promise<boolean>,
    private cancelCountdown: () => void,
    private isCountingDown: () => boolean,
  ) {}

  static readonly COUNTDOWN_SECONDS = 3;

  /** getDisplayMedia() in the renderer resolves to this window, no picker. */
  install() {
    session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
      const src = await this.source();
      if (src) cb({ video: src });
      else cb({});
    });
  }

  private async source() {
    if (this.mode === 'glass') {
      const display = screen.getDisplayMatching(this.win.getBounds());
      const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      return screens.find((s) => s.display_id === String(display.id)) ?? screens[0] ?? null;
    }
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    const id = this.win.getMediaSourceId();
    return sources.find((s) => s.id === id) ?? null;
  }

  async sourceId(): Promise<string> {
    return (await this.source())?.id ?? this.win.getMediaSourceId();
  }

  get active() {
    return this.state !== null;
  }

  toggle() {
    if (this.isCountingDown()) this.cancelCountdown();
    else if (this.state || this.starting) this.stop();
    else void this.start(false);
  }

  async start(mic: boolean) {
    if (this.state || this.starting || this.isCountingDown()) return;
    if (mic && process.platform === 'darwin') {
      const ok = await systemPreferences.askForMediaAccess('microphone');
      if (!ok) {
        notify('Microphone is off for Slate', 'Allow it in System Settings → Privacy & Security → Microphone.');
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
        return;
      }
    }
    this.mic = mic;
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
      notify('Screen recording is off for Slate', 'Allow it in System Settings → Privacy & Security → Screen Recording.');
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      return;
    }
    if (!(await this.countdown(Recorder.COUNTDOWN_SECONDS))) return; // cancelled
    if (this.state || this.starting) return;
    // Glass mode records the whole display and crops afterwards — that needs ffmpeg.
    this.mode = this.tabs.prefs.recordMode === 'glass' && findFfmpeg() ? 'glass' : 'window';
    this.crop = null;
    if (this.mode === 'glass') {
      const b = this.win.getBounds();
      const d = screen.getDisplayMatching(b);
      const k = d.scaleFactor;
      this.crop = {
        x: Math.round((b.x - d.bounds.x) * k), y: Math.round((b.y - d.bounds.y) * k),
        w: Math.round(b.width * k), h: Math.round(b.height * k),
      };
    }
    this.starting = true;
    this.win.webContents.send('rec:start', { mode: this.mode, mic: this.mic, micLabel: this.tabs.prefs.micLabel });
  }

  /** The renderer has a live MediaRecorder; open the file before its first chunk lands. */
  started(mimeType: string) {
    if (!this.starting) return;
    const dir = this.tabs.dirs.recordDir;
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `slate-${stamp()}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`);
    this.stream = createWriteStream(this.file);
    this.state = { startedAt: Date.now(), file: this.file, mic: this.mic };
    this.tabs.setRecording(this.state);
    this.showTray();
  }

  chunk(buf: ArrayBuffer) {
    this.stream?.write(Buffer.from(buf));
  }

  stop() {
    this.win.webContents.send('rec:stop');
  }

  /** The renderer flushed its last chunk (or failed to start). */
  done(error?: string) {
    const file = this.file;
    const stream = this.stream;
    this.stream = null;
    this.file = null;
    this.state = null;
    this.starting = false;
    this.hideTray();
    this.tabs.setRecording(null);
    if (error) notify('Recording failed', error);
    if (!file || !stream) return;
    stream.end(() => {
      if (error || safeSize(file) === 0) {
        try { unlinkSync(file); } catch { /* nothing to remove */ }
        if (!error) notify('Recording failed', 'No video was captured.');
        return;
      }
      void finalize(file, this.crop).then((out) => {
        notify('Recording saved', out.replace(app.getPath('home'), '~'));
        shell.showItemInFolder(out);
      });
    });
  }

  private showTray() {
    if (process.platform !== 'darwin') return;
    this.tray = new Tray(nativeImage.createEmpty());
    this.tray.setToolTip('Slate is recording — click to stop');
    this.tray.on('click', () => this.stop());
    const update = () => {
      if (!this.state || !this.tray) return;
      const s = Math.floor((Date.now() - this.state.startedAt) / 1000);
      const mic = this.state.mic ? ' mic' : '';
      this.tray.setTitle(`● ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${mic}`, { fontType: 'monospacedDigit' });
    };
    update();
    this.tick = setInterval(update, 1000);
  }

  private hideTray() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    this.tray?.destroy();
    this.tray = null;
  }
}

/**
 * MediaRecorder output lacks duration/seek metadata. If ffmpeg is around, rewrite the
 * container (losslessly when no crop is needed; re-encoded when cropping a screen
 * recording down to the window). Without ffmpeg the raw file is kept as is.
 */
function finalize(file: string, crop: { x: number; y: number; w: number; h: number } | null): Promise<string> {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) return Promise.resolve(file);
  const out = file.replace(/\.(mp4|webm)$/, '.final.mp4');
  const args = crop
    ? ['-y', '-v', 'error', '-i', file,
       '-vf', `crop=${even(crop.w)}:${even(crop.h)}:${crop.x}:${crop.y}`,
       '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', out]
    : ['-y', '-v', 'error', '-i', file, '-c', 'copy', '-movflags', '+faststart', out];
  return new Promise((resolve) => {
    execFile(ffmpeg, args, (err) => {
      if (err || safeSize(out) === 0) {
        try { unlinkSync(out); } catch { /* ignore */ }
        resolve(file);
        return;
      }
      const clean = file.replace(/\.(mp4|webm)$/, '.mp4');
      try { unlinkSync(file); } catch { /* ignore */ }
      try { renameSync(out, clean); resolve(clean); } catch { resolve(out); }
    });
  });
}

const even = (n: number) => n - (n % 2); // yuv420p needs even dimensions

export function findFfmpeg(): string | null {
  const dirs = [...(process.env.PATH ?? '').split(delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const d of dirs) {
    const p = join(d, 'ffmpeg');
    if (d && existsSync(p)) return p;
  }
  return null;
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeSize(file: string) {
  try { return statSync(file).size; } catch { return 0; }
}

function notify(title: string, body: string) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}
