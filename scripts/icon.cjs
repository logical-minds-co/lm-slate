/*
 * Builds the app icon from assets/icon-source.png.
 * The source is a 256px raster of a simple mark (rounded-square outline + pill), so instead of
 * upscaling it we measure its geometry and colours and redraw it as SVG, then render that at
 * 1024px with Electron and emit assets/icon.svg, assets/icon.png and build/icon.icns.
 *
 *   npm run icon
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const { mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const root = join(__dirname, '..');
const SRC = join(root, 'assets', 'icon-source.png');

function measure() {
  const img = nativeImage.createFromPath(SRC);
  const { width: W, height: H } = img.getSize();
  const buf = img.toBitmap(); // BGRA
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] };
  };
  const isPurple = (p) => p.a > 128 && p.b - p.g > 60 && p.b > p.r;
  const isGray = (p) => p.a > 128 && Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) < 16 && !isPurple(p);

  const bbox = (test) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (test(px(x, y))) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const bar = bbox(isPurple);
  const box = bbox(isGray);

  // stroke width: run of gray pixels from the left edge at the box's vertical middle
  const midY = box.y + Math.floor(box.h / 2);
  let stroke = 0;
  for (let x = box.x; x < box.x + box.w && isGray(px(x, midY)); x++) stroke++;
  // outer corner radius: on the top row of the box, the first gray pixel sits `r` in from the left edge
  let firstTop = box.x;
  for (let x = box.x; x < box.x + box.w; x++) if (isGray(px(x, box.y))) { firstTop = x; break; }
  const radius = firstTop - box.x;

  const hex = (p) => '#' + [p.r, p.g, p.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const purple = hex(px(bar.x + Math.floor(bar.w / 2), bar.y + Math.floor(bar.h / 2)));
  const gray = hex(px(box.x + Math.floor(stroke / 2), midY));

  return { W, H, bar, box, stroke, radius, purple, gray };
}

function svg(m) {
  const s = m.stroke;
  // the stroke is centred on the path, so inset the rect by half the stroke width
  const rx = m.radius - s / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.W} ${m.H}" width="${m.W}" height="${m.H}">
  <rect x="${m.box.x + s / 2}" y="${m.box.y + s / 2}" width="${m.box.w - s}" height="${m.box.h - s}" rx="${rx}" fill="none" stroke="${m.gray}" stroke-width="${s}"/>
  <rect x="${m.bar.x}" y="${m.bar.y}" width="${m.bar.w}" height="${m.bar.h}" rx="${m.bar.w / 2}" fill="${m.purple}"/>
</svg>
`;
}

async function render(svgText, size) {
  const win = new BrowserWindow({
    width: size, height: size, show: false, transparent: true, frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svgText.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return image;
}

app.whenReady().then(async () => {
  const m = measure();
  console.log('measured', JSON.stringify(m));
  const svgText = svg(m);
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'assets', 'icon.svg'), svgText);

  const big = await render(svgText, 1024);
  const corner = big.toBitmap();
  console.log(`corner alpha: ${corner[3]} (0 = transparent), size ${big.getSize().width}x${big.getSize().height}`);
  writeFileSync(join(root, 'assets', 'icon.png'), big.toPNG());

  const iconset = join(root, 'build', 'icon.iconset');
  rmSync(iconset, { recursive: true, force: true });
  mkdirSync(iconset, { recursive: true });
  for (const base of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = base * scale;
      const name = `icon_${base}x${base}${scale === 2 ? '@2x' : ''}.png`;
      writeFileSync(join(iconset, name), big.resize({ width: px, height: px, quality: 'best' }).toPNG());
    }
  }
  if (process.platform === 'darwin') {
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build', 'icon.icns')]);
    console.log('wrote build/icon.icns');
  }
  console.log('wrote assets/icon.svg, assets/icon.png');
  app.quit();
});
