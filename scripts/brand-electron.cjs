/*
 * Development-only branding for the Electron binary in node_modules.
 * macOS takes the Dock label, the application menu title and the About panel from the
 * bundle's Info.plist — not from app.setName() — so without this the running app says
 * "Electron". We rename the bundle (keeping its identifier, so granted permissions such as
 * Screen Recording survive), drop in our icon and re-sign ad hoc, which Apple silicon
 * requires after any change inside a bundle. Runs on `npm install`; safe to run again.
 * Packaged builds don't need this: electron-builder writes a proper Slate.app.
 */
const { execFileSync } = require('node:child_process');
const { existsSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');

if (process.platform !== 'darwin') process.exit(0);

const root = join(__dirname, '..');
const appDir = join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = join(appDir, 'Contents', 'Info.plist');
const icns = join(root, 'build', 'icon.icns');
if (!existsSync(plist)) process.exit(0);

const read = (key) => execFileSync('plutil', ['-extract', key, 'raw', plist], { encoding: 'utf8' }).trim();
const NAME = 'Slate';
let changed = false;

for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  if (read(key) !== NAME) {
    execFileSync('plutil', ['-replace', key, '-string', NAME, plist]);
    changed = true;
  }
}
if (existsSync(icns)) {
  const target = join(appDir, 'Contents', 'Resources', read('CFBundleIconFile') || 'electron.icns');
  copyFileSync(icns, target);
  changed = true;
}
if (changed) {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appDir], { stdio: 'ignore' });
  console.log('slate: branded the development Electron bundle as Slate');
}
