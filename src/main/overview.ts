import { BrowserWindow } from 'electron';
import type { TabManager } from './tabs';
import type { Palette } from './palette';
import type { OverviewCell, OverviewPayload, Rect } from '../shared/overview';

export interface TerminalSnapshot { lines: string[]; cols: number; rows: number }

const PAD_X = 56, PAD_TOP = 36, PAD_BOTTOM = 56, GAP = 32, LABEL = 24;
const MIN_ZOOM = 0.25; // Chromium's floor

/**
 * The mosaic: every browser view is tiled live into a grid cell (zoomed out to fit),
 * terminals are drawn as text snapshots by the overlay page, which also handles input.
 */
export class Overview {
  private open_ = false;
  private pendingSnapshots: ((s: Record<string, TerminalSnapshot>) => void) | null = null;

  constructor(private win: BrowserWindow, private tabs: TabManager, private palette: Palette) {
    palette.onOverviewClosed = () => this.restore();
  }

  get isOpen() {
    return this.open_;
  }

  toggle() {
    if (this.open_) this.palette.close();
    else void this.open();
  }

  async open() {
    if (this.open_) return;
    const all = this.tabs.state().tabs;
    if (all.length === 0) return;
    this.open_ = true;
    this.tabs.frozen = true;

    const snapshots = await this.requestSnapshots();
    if (!this.open_) return; // closed while waiting

    const area = this.tabs.contentBounds();
    const rects = gridRects(all.length, area);
    const views = new Map(this.tabs.browserViews().map((b) => [b.id, b]));
    const activeId = this.tabs.state().activeId;

    const cells: OverviewCell[] = all.map((t, i) => {
      const rect = rects[i];
      const cell: OverviewCell = { id: t.id, kind: t.kind, title: t.title, active: t.id === activeId, rect, url: t.url };
      if (t.kind === 'browser') {
        const b = views.get(t.id);
        if (b) {
          b.view.setBounds(rect);
          b.view.setVisible(true);
          b.view.webContents.setZoomFactor(Math.max(MIN_ZOOM, rect.width / area.width));
        }
      } else {
        const snap = snapshots[t.id];
        if (snap) { cell.lines = snap.lines; cell.cols = snap.cols; cell.rows = snap.rows; }
      }
      return cell;
    });

    this.win.webContents.send('ui:overview', true);
    const payload: OverviewPayload = { cells, dark: this.tabs.state().dark };
    this.palette.showOverview(payload);
  }

  /** Called by the palette when the overlay goes away: put every view back where it lives. */
  private restore() {
    if (!this.open_) return;
    this.open_ = false;
    this.tabs.frozen = false;
    for (const b of this.tabs.browserViews()) b.view.webContents.setZoomFactor(1);
    this.tabs.syncVisibility();
    this.tabs.layout();
    this.win.webContents.send('ui:overview', false);
  }

  pick(id: string) {
    this.palette.close(); // → restore()
    this.tabs.activate(id);
  }

  receiveSnapshots(s: Record<string, TerminalSnapshot>) {
    this.pendingSnapshots?.(s);
    this.pendingSnapshots = null;
  }

  private requestSnapshots(): Promise<Record<string, TerminalSnapshot>> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pendingSnapshots = null; resolve({}); }, 400);
      this.pendingSnapshots = (s) => { clearTimeout(timer); resolve(s); };
      this.win.webContents.send('snapshots:request');
    });
  }
}

/** Lay `n` previews (same aspect as `area`) out in the grid that gives them the most room. */
export function gridRects(n: number, area: Rect): Rect[] {
  const aspect = area.width / Math.max(1, area.height);
  const W = area.width - PAD_X * 2;
  const H = area.height - PAD_TOP - PAD_BOTTOM;
  let best = { cols: 1, w: 0, h: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (W - GAP * (cols - 1)) / cols;
    const cellH = (H - GAP * (rows - 1)) / rows - LABEL;
    const w = Math.min(cellW, cellH * aspect);
    const h = w / aspect;
    if (w > best.w) best = { cols, w, h };
  }
  const { cols, w, h } = best;
  const rows = Math.ceil(n / cols);
  const gridW = cols * w + GAP * (cols - 1);
  const gridH = rows * (h + LABEL) + GAP * (rows - 1);
  const x0 = area.x + PAD_X + (W - gridW) / 2;
  const y0 = area.y + PAD_TOP + (H - gridH) / 2;
  return Array.from({ length: n }, (_, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols; // centre a short last row
    const rowOffset = ((cols - inRow) * (w + GAP)) / 2;
    return {
      x: Math.round(x0 + rowOffset + c * (w + GAP)),
      y: Math.round(y0 + r * (h + LABEL + GAP)),
      width: Math.round(w),
      height: Math.round(h),
    };
  });
}
