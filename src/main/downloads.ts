import { app, Notification, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { TabManager } from './tabs';

/** Browser downloads go straight to the configured folder — no dialog — and announce themselves when done. */
export function installDownloads(tabs: () => TabManager | null) {
  session.defaultSession.on('will-download', (_e, item) => {
    const dir = tabs()?.dirs.downloadDir ?? app.getPath('downloads');
    const file = uniquePath(dir, item.getFilename());
    item.setSavePath(file);
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Downloaded', body: basename(file), silent: true });
        n.on('click', () => shell.showItemInFolder(file));
        n.show();
      }
    });
  });
}

function uniquePath(dir: string, name: string) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = join(dir, name);
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}
