import React from 'react';
import { PRIORITY_LABEL, STATUS_LABEL, avatarColor, initials } from '../lib/format.js';

/**
 * Single-line text that truncates with … and shows a custom styled tooltip with the full text on
 * hover — but ONLY when the text is actually clipped (so short labels get no tooltip). Instant,
 * dark, on-brand (see `.tt` in styles.css). Use anywhere a long value must fit a narrow box.
 */
export function Truncate({ children, className = '' }) {
  const ref = React.useRef(null);
  const [clipped, setClipped] = React.useState(false);
  const text = typeof children === 'string' ? children : '';
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) setClipped(el.scrollWidth > el.clientWidth + 1);
  }, [children]);
  // Outer wrapper carries the tooltip (no overflow clip); inner span does the ellipsis. Keeping
  // them separate means the ellipsis' overflow:hidden can't clip the tooltip pseudo-element.
  return (
    <span className={`trunc-wrap ${className}`} data-tip={clipped ? text : undefined} title={clipped ? text : undefined}>
      <span ref={ref} className="trunc-inner">{children}</span>
    </span>
  );
}

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
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    filter: <><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></>,
    route: <><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M6 16V9a4 4 0 0 1 4-4h4" /></>,
    palette: <><circle cx="12" cy="12" r="10" /><circle cx="8" cy="10" r="1" /><circle cx="12" cy="8" r="1" /><circle cx="16" cy="10" r="1" /><path d="M12 22a10 10 0 0 1 0-20c4 0 6 3 6 6a3 3 0 0 1-3 3h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22z" /></>,
    hash: <><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" /></>,
    tag: <><path d="M20.59 13.41 12 22l-9-9V3h10l7.59 7.59a2 2 0 0 1 0 2.82z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
    chevron: <><path d="m9 18 6-6-6-6" /></>,
    lifebuoy: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M14.83 9.17l3.53-3.53M4.93 19.07l4.24-4.24" /></>
  };
  return <svg {...p} className="ico">{paths[name] || null}</svg>;
}

/**
 * A section header: icon in a soft tile + title + one-line description. Makes each settings group
 * self-explanatory. Used across Settings and the wizard.
 */
export function SectionHeader({ icon, title, description }) {
  return (
    <div className="section-head">
      {icon && <span className="section-ico"><Icon name={icon} size={18} /></span>}
      <div>
        <div className="section-head-title">{title}</div>
        {description && <div className="section-head-desc">{description}</div>}
      </div>
    </div>
  );
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
        {selected
          ? <Truncate className="hd-select-val">{selected.label}</Truncate>
          : <span className="hd-select-ph">{placeholder}</span>}
        <svg className={`hd-select-caret ${open ? 'up' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <ul className="hd-select-menu" role="listbox">
          {options.length === 0 && <li className="hd-select-empty">No options</li>}
          {options.map((o, i) => (
            <li key={o.value ?? `opt-${i}`} role="option" aria-selected={o.value === value}
              className={`hd-select-opt ${o.value === value ? 'sel' : ''} ${i === active ? 'active' : ''} ${o.disabled ? 'disabled' : ''}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <Truncate className="hd-select-opt-label">{o.label}</Truncate>
              {o.meta && <span className="hd-select-meta">{o.meta}</span>}
              {o.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Tag/chip input. Type a value + Enter (or comma) to add a chip; Backspace on empty removes the
 * last; click × to remove. value is a string[]; onChange(nextArray). De-dupes + lowercases.
 */
export function TagInput({ value = [], onChange, placeholder = 'Type and press Enter…' }) {
  const [draft, setDraft] = React.useState('');
  const inputRef = React.useRef(null);

  const add = (raw) => {
    const tag = String(raw).trim().toLowerCase();
    if (!tag) return;
    if (!value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };
  const removeAt = (i) => onChange(value.filter((_, idx) => idx !== i));

  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft); }
    else if (e.key === 'Backspace' && !draft && value.length) removeAt(value.length - 1);
  };

  return (
    <div className="tag-input" onClick={() => inputRef.current?.focus()}>
      {value.map((tag, i) => (
        <span className="tag-chip" key={`${tag}-${i}`}>
          {tag}
          <button type="button" className="tag-x" aria-label={`Remove ${tag}`} onClick={(e) => { e.stopPropagation(); removeAt(i); }}>×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="tag-field"
        value={draft}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
      />
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
