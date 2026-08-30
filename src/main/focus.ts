import { Notification, session, shell } from 'electron';
import type { TabManager } from './tabs';

export const BLOCKED_URL = 'slate://blocked/';

/** Normalises "https://www.YouTube.com/x" or "youtube.com" to "youtube.com". */
export function normaliseDomain(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  try { if (/^[a-z]+:\/\//.test(s)) s = new URL(s).hostname; } catch { /* keep as typed */ }
  s = s.replace(/^www\./, '').replace(/\/.*$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

export function hostMatches(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => h === d || h.endsWith('.' + d));
}

/** Redirects main-frame navigations to blocked domains while a focus session is active. */
export function installBlocking(tabs: () => TabManager | null) {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const m = tabs();
    if (!m || !m.focusActive() || (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame')) {
      cb({});
      return;
    }
    let host = '';
    try { host = new URL(details.url).hostname; } catch { /* ignore */ }
    if (host && m.isBlocked(host)) cb({ redirectURL: `${BLOCKED_URL}?host=${encodeURIComponent(host)}` });
    else cb({});
  });
}

export function notifyDone(task: string) {
  shell.beep();
  if (Notification.isSupported()) {
    new Notification({ title: 'Focus session done', body: task, silent: true }).show();
  }
}
