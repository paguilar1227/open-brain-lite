import { useEffect, useState } from 'react';

export function useIsMobile(breakpoint = 820) {
  const [mobile, setMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const onR = () => setMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [breakpoint]);
  return mobile;
}
