// A UUID generator that also works in INSECURE browser contexts.
//
// `crypto.randomUUID()` is only defined in *secure* contexts (https or
// localhost). The dev server binds to all interfaces (vite `server.host: true`)
// so a phone / another device can reach it over LAN or tailnet at an
// `http://<ip>` origin — an insecure context where `crypto.randomUUID` is
// `undefined`. Calling it there throws; and when the call sits inside a React
// state updater, that throw happens during render and unmounts the whole app
// (blank screen). `crypto.getRandomValues`, by contrast, IS available in
// insecure contexts, so we fall back to a v4 UUID built from it.
export function uid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
