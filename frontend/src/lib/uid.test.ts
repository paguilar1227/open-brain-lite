import { afterEach, describe, expect, it, vi } from 'vitest';
import { uid } from './uid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a v4 UUID string', () => {
    expect(uid()).toMatch(V4);
  });

  it('produces distinct values', () => {
    expect(uid()).not.toBe(uid());
  });

  // Regression: over LAN/tailnet the dev server is reached at http://<ip>, an
  // insecure context where crypto.randomUUID is undefined. The old code called
  // it directly inside a setQueue updater, so the throw crashed React to a blank
  // screen. uid() must fall back to getRandomValues and never touch randomUUID.
  it('works in an insecure context where crypto.randomUUID is undefined', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff;
        return a;
      },
    });
    expect(() => uid()).not.toThrow();
    expect(uid()).toMatch(V4);
  });
});
