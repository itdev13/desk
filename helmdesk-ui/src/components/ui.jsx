import React from 'react';
import { PRIORITY_LABEL, STATUS_LABEL, avatarColor, initials } from '../lib/format.js';

/** Minimal inline icon set (stroke-based, currentColor). */
export function Icon({ name, size = 17 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>,
    users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    board: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M15 3v18" /></>,
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
    alert: <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>,
    search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    check: <><path d="M20 6 9 17l-5-5" /></>,
    back: <><path d="M19 12H5M12 19l-7-7 7-7" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>
  };
  return <svg {...p} className="ico">{paths[name] || null}</svg>;
}

export function PriorityPill({ priority }) {
  return <span className={`pill ${priority}`}>{PRIORITY_LABEL[priority] || priority}</span>;
}

export function StatusPill({ status }) {
  const tone = status === 'resolved' || status === 'closed' ? 'good' : status === 'pending' || status === 'on_hold' ? 'warn' : 'info';
  return <span className={`pill ${tone}`}>{STATUS_LABEL[status] || status}</span>;
}

export function Avatar({ name, size = 30 }) {
  if (!name) return <div className="avatar" style={{ width: size, height: size, background: '#5a687f' }}>—</div>;
  return (
    <div className="avatar" style={{ width: size, height: size, background: avatarColor(name) }} title={name}>
      {initials(name)}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="center-screen">
      <div className="spinner" />
    </div>
  );
}

export function Toast({ message, error, onDone }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return <div className={`toast ${error ? 'err' : ''}`}>{message}</div>;
}

/**
 * Styled dropdown replacing the native <select> (which ignores our design system).
 * Props: value, onChange(value), options [{value,label,meta?,disabled?}], placeholder.
 * Keyboard: Enter/Space/ArrowDown opens; Esc closes; click-outside closes.
 */
export function Select({ value, onChange, options = [], placeholder = 'Select…', disabled = false }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const ref = React.useRef(null);
  const selected = options.find((o) => o.value === value);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (opt) => { if (opt.disabled) return; onChange(opt.value); setOpen(false); };

  const onKey = (e) => {
    if (disabled) return;
    if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); setActive(Math.max(0, options.findIndex((o) => o.value === value))); return; }
    if (!open) return;
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(options[active]); }
  };

  return (
    <div className={`hd-select ${disabled ? 'is-disabled' : ''}`} ref={ref}>
      <button type="button" className={`hd-select-trigger ${open ? 'open' : ''}`} disabled={disabled}
        onClick={() => setOpen((v) => !v)} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open}>
        <span className={selected ? 'hd-select-val' : 'hd-select-ph'}>{selected ? selected.label : placeholder}</span>
        <svg className={`hd-select-caret ${open ? 'up' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="hd-select-menu" role="listbox">
          {options.length === 0 && <li className="hd-select-empty">No options</li>}
          {options.map((o, i) => (
            <li key={o.value ?? `opt-${i}`} role="option" aria-selected={o.value === value}
              className={`hd-select-opt ${o.value === value ? 'sel' : ''} ${i === active ? 'active' : ''} ${o.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span>{o.label}</span>
              {o.meta && <span className="hd-select-meta">{o.meta}</span>}
              {o.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Switch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}
