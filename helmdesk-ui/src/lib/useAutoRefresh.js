import { useEffect, useRef, useState } from 'react';

/**
 * Returns `value` delayed by `delay` ms — updates only after the input stops changing. Use to
 * avoid firing a search request on every keystroke (search runs ~delay ms after the user pauses).
 */
export function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/**
 * Keep a view fresh without manual reloads. Calls `fn`:
 *   - on an interval (default 20s) — catches changes made by other agents / new inbound tickets
 *   - when the tab/window regains focus or becomes visible — catches changes after you were away
 *
 * `fn` should be a stable callback (wrap in useCallback). Polling pauses while the tab is hidden
 * (no point fetching in the background) and fires once immediately on becoming visible again.
 */
export function useAutoRefresh(fn, { intervalMs = 20000, enabled = true } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => { if (!document.hidden) fnRef.current(); };
    const id = setInterval(tick, intervalMs);

    const onFocus = () => fnRef.current();
    const onVisible = () => { if (!document.hidden) fnRef.current(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, enabled]);
}
