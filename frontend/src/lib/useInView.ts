// Tiny IntersectionObserver hook used by infinite-scroll surfaces.
// Returns a callback ref + a boolean that flips true while the
// observed element is on-screen.
//
// We use a callback ref rather than a useRef + useEffect([]) because
// the sentinel typically renders conditionally (after loading state
// clears). A plain useRef would be null on the effect's first run and
// never re-observe; a callback ref fires whenever the element attaches
// or detaches, so the observer is rebuilt at the right moment.

import { useCallback, useEffect, useRef, useState } from 'react';

export function useInView<T extends Element = HTMLElement>(options?: IntersectionObserverInit): {
  ref: (node: T | null) => void;
  inView: boolean;
} {
  const [inView, setInView] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      options,
    );
    io.observe(node);
    observerRef.current = io;
    // options is a stable plain object in our callers; we intentionally
    // don't re-bind on identity changes — the observer captures the
    // first options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    },
    [],
  );

  return { ref, inView };
}
