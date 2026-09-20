import { useEffect, useState } from 'react';

/**
 * A value that settles rather than changing on every keystroke.
 *
 * Not useDeferredValue: that re-renders with a stale value, but the value
 * still changes once per character - and what matters here is how often
 * anything downstream is told the search changed at all.
 *
 * 200ms is under the ~300ms where a delay starts to feel like lag, and above
 * a fast typist's interval.
 */
export function useDebounced<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return settled;
}
