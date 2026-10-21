import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Resizable 3-pane layout for the Inbox (list │ center │ details). Left & right widths in px
 * (center flexes). Drag a boundary handle to resize; widths persist to localStorage across the
 * session. Widths are clamped to [MIN, MAX] so a pane can never vanish. Returns
 * { leftW, rightW, startDrag(side), resetWidths }.
 */
const KEY = 'helmdesk.inbox.panes.v1';
const DEFAULTS = { leftW: 450, rightW: 320, leftOpen: true, rightOpen: true };
const MIN = 350, MAX = 660;

const clamp = (v) => Math.max(MIN, Math.min(MAX, v));

function load() {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    // Re-clamp the saved widths to the CURRENT min/max — otherwise a width dragged narrow before the
    // minimum was raised would persist below it (the clamp only ran on drag, not on load).
    return { ...saved, leftW: clamp(saved.leftW), rightW: clamp(saved.rightW) };
  } catch { return { ...DEFAULTS }; }
}

export function useResizablePanes() {
  const [{ leftW, rightW, leftOpen, rightOpen }, setState] = useState(load);
  const drag = useRef(null); // { side, startX, startW }

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ leftW, rightW, leftOpen, rightOpen })); } catch { /* ignore */ }
  }, [leftW, rightW, leftOpen, rightOpen]);

  const onMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    // Left handle grows the left pane as you drag right; right handle grows the right pane as you drag left.
    const next = clamp(d.side === 'left' ? d.startW + dx : d.startW - dx);
    setState((s) => (d.side === 'left' ? { ...s, leftW: next } : { ...s, rightW: next }));
  }, []);

  const onUp = useCallback(() => {
    drag.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove]);

  const startDrag = useCallback((side) => (e) => {
    e.preventDefault();
    setState((s) => { drag.current = { side, startX: e.clientX, startW: side === 'left' ? s.leftW : s.rightW }; return s; });
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onMove, onUp]);

  useEffect(() => () => onUp(), [onUp]); // cleanup on unmount

  const resetWidths = useCallback(() => setState({ ...DEFAULTS }), []);
  const toggleLeft = useCallback(() => setState((s) => ({ ...s, leftOpen: !s.leftOpen })), []);
  const toggleRight = useCallback(() => setState((s) => ({ ...s, rightOpen: !s.rightOpen })), []);

  // Effective widths: 0 when collapsed (grid column disappears).
  const effLeft = leftOpen ? leftW : 0;
  const effRight = rightOpen ? rightW : 0;

  return { leftW: effLeft, rightW: effRight, leftOpen, rightOpen, startDrag, resetWidths, toggleLeft, toggleRight };
}
