// Tiny debounce hook. Returns a value that lags `ms` behind the
// argument — useful for taming live-search input flux so we don't fire
// a network request per keystroke.
//
// CommandPalette has its own inline copy with 180ms; HomePage uses the
// same tuning. Centralized here so future call sites don't reinvent it.

import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
