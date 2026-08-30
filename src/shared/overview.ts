import type { TabKind } from './types';

export interface Rect { x: number; y: number; width: number; height: number }

export interface OverviewCell {
  id: string;
  kind: TabKind;
  title: string;
  active: boolean;
  /** Where the preview sits, in window content coordinates. */
  rect: Rect;
  /** Terminal text snapshot (last rows), only for terminals. */
  lines?: string[];
  /** Columns/rows of the terminal, so the snapshot can be scaled to fit. */
  cols?: number;
  rows?: number;
  url?: string;
}

export interface OverviewPayload {
  cells: OverviewCell[];
  dark: boolean;
}
