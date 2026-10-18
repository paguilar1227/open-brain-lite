import { embeddedHost } from './host';
import { useEffect, useState } from 'react';

export function useIsMobile(breakpoint = 820) {
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : (embeddedHost()?.element.clientWidth ?? window.innerWidth) < breakpoint,
  );
  useEffect(() => {
    const onR = () => setMobile((embeddedHost()?.element.clientWidth ?? window.innerWidth) < breakpoint);
    window.addEventListener('resize', onR);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onR);
    const element = embeddedHost()?.element;
    if (element) observer?.observe(element);
    return () => { observer?.disconnect(); window.removeEventListener('resize', onR); };
  }, [breakpoint]);
  return mobile;
}
