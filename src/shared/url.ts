import { SEARCH_ENGINES, type SearchEngine } from './search';

export const BLANK_URL = 'about:blank';

const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;                 // https://, file://, …
const SCHEME_NO_SLASHES = /^(about|slate|mailto|data|blob|javascript|chrome):/i;
const LOCALHOST = /^localhost(?=$|[:/?#])/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}(?=$|[:/?#])/;
const HOST_PORT = /^[a-z0-9-]+(\.[a-z0-9-]+)*:\d{1,5}(?=$|[/?#])/i;   // dev.local:8080, localhost:3000
const DOMAIN = /^[^\s/?#]+\.[a-z0-9-]{2,}(?=$|[:/?#])/i;             // example.com, docs.foo.dev/path

/** Does this text name a place to go, rather than something to search for? */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  return EXPLICIT_SCHEME.test(s) || SCHEME_NO_SLASHES.test(s) || LOCALHOST.test(s) || IPV4.test(s) || HOST_PORT.test(s) || DOMAIN.test(s);
}

/** Turns whatever the user typed into a URL: local hosts get http, bare domains https, everything else a search. */
export function toUrl(input: string, engine: SearchEngine): string {
  const s = input.trim();
  if (!s) return BLANK_URL;
  if (EXPLICIT_SCHEME.test(s) || SCHEME_NO_SLASHES.test(s)) return s;
  if (LOCALHOST.test(s) || IPV4.test(s) || HOST_PORT.test(s)) return `http://${s}`;
  if (DOMAIN.test(s)) return `https://${s}`;
  return SEARCH_ENGINES[engine].url + encodeURIComponent(s);
}
