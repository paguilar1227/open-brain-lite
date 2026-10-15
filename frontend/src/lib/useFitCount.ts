import { useLayoutEffect, useState } from 'react';

// Compute how many rows of approximate height `rowPx` fit inside a
// container, re-measuring on size changes. Used by Home's column
// widgets so they show as many items as the viewport allows instead
// of a hard-coded slice.
//
// API: returns [count, refCallback]. The ref callback is the wire to
// React's ref system — pass it as `ref={refCallback}` on the element
// to measure. We use a callback ref (and useState to hold the element)
// instead of useRef because useEffect with [ref] as dependency does
// NOT re-run when ref.current changes — so when the host's first
// render shows a loading state (which doesn't include the measured
// element), then a later render attaches it, the effect would never
// re-fire. setState DOES trigger re-render, which re-runs the effect
// with the freshly-attached element.
//
// We use an average row height instead of measuring each rendered
// row because rows vary (subtask indicators, comment counts, due
// chips). Pessimistic averages err on showing one fewer row than
// would fit — safer (no clipped row).
export function useFitCount(
  rowPx: number,
  opts: { min?: number; reserveBottomPx?: number } = {},
): [number, (el: HTMLElement | null) => void] {
  const { min = 3, reserveBottomPx = 0 } = opts;
  const [count, setCount] = useState<number>(6);
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      const avail = Math.max(0, h - reserveBottomPx);
      setCount(Math.max(min, Math.floor(avail / rowPx)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, rowPx, reserveBottomPx, min]);
  return [count, setEl];
}
