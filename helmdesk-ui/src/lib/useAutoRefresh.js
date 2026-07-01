import { useEffect, useRef } from 'react';

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
