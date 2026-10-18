import type { Route } from '../types';

export interface EmbeddedHost { element: HTMLElement; apiBase: string; assetBase: string; initialRoute?: Route }
let host: EmbeddedHost | undefined;
let cursor = 0;
let entries: Array<{ state: unknown; url: URL }> = [];
const listeners = new Set<() => void>();
export function configureHost(value: EmbeddedHost) {
  host = value;
  entries = [{ state: { obRoute: value.initialRoute ?? { route: 'home' } }, url: new URL('/', window.location.origin) }]; cursor = 0;
}
export function embeddedHost() { return host; }
export function resourceUrl(value: string | null | undefined) {
  return host && value?.startsWith('/api/files/') ? `${host.assetBase}${value}` : value;
}
export function apiBase() { return host?.apiBase ?? '/api/v1'; }
export const navigation = {
  get location() { return host ? entries[cursor].url : window.location; },
  get history() {
    if (!host) return window.history;
    return {
      get state() { return entries[cursor].state; },
      pushState(state: unknown, _unused: string, url?: string | URL | null) { entries.splice(++cursor); entries.push({ state, url: new URL(url ?? entries[cursor - 1].url, window.location.origin) }); },
      replaceState(state: unknown, _unused: string, url?: string | URL | null) { entries[cursor] = { state, url: new URL(url ?? entries[cursor].url, window.location.origin) }; },
      back() { if (cursor > 0) { cursor--; for (const listener of listeners) listener(); } },
    };
  },
};
export function onNavigation(listener: () => void) {
  if (!host) { window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); }
  listeners.add(listener); return () => { listeners.delete(listener); };
}

export function onHostEvent<K extends 'keydown' | 'mousedown'>(type: K, listener: (event: DocumentEventMap[K]) => void, capture = false) {
  const root = host?.element.shadowRoot ?? document;
  root.addEventListener(type, listener as EventListener, capture);
  return () => root.removeEventListener(type, listener as EventListener, capture);
}
