import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Select } from './ui.jsx';

/**
 * Manual ticket creation (Path C). Agent logs a ticket on a customer's behalf.
 * The contact is PICKED from the location's GHL contacts (search by name, email or phone), so the
 * ticket is linked to the real contact — it then shows in that contact's Tickets modal, replies reach
 * them through GHL, and the ticket gets a "View contact" link.
 */
export default function NewTicketModal({ onClose, onCreated, notify }) {
  const [form, setForm] = useState({ subject: '', channel: 'Email', priority: 'normal', firstMessage: '' });
  const [contact, setContact] = useState(null); // { id, name, email, phone }
  const [saving, setSaving] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const submit = async () => {
    if (!contact) { notify('Pick the contact this ticket is for', true); return; }
    if (!form.subject.trim() && !form.firstMessage.trim()) { notify('Add a subject or message', true); return; }
    setSaving(true);
    try {
      const res = await api.createTicket({ ...form, contactId: contact.id });
      onCreated(res.ticket);
    } catch (err) {
      notify(err.message, true);
      setSaving(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, marginBottom: 16 }}>New ticket</h3>
        <div className="field">
          <label>Contact</label>
          <ContactPicker value={contact} onChange={setContact} />
        </div>
        <div className="field">
          <label>Subject</label>
          <input type="text" value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Brief summary of the issue" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>Channel</label>
            <Select value={form.channel} onChange={(v) => set({ channel: v })}
              options={CHANNELS.map((c) => ({ value: c.key, label: c.label }))} />
          </div>
          <div className="field">
            <label>Priority</label>
            <Select value={form.priority} onChange={(v) => set({ priority: v })}
              options={['urgent', 'high', 'normal', 'low'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
          </div>
        </div>
        <div className="field">
          <label>Details</label>
          <textarea value={form.firstMessage} onChange={(e) => set({ firstMessage: e.target.value })} placeholder="What's the issue?" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" disabled={saving || !contact} onClick={submit}>{saving ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </div>
    </div>
  );
}

/** Type-ahead over the location's GHL contacts. Debounced; ignores out-of-order responses. */
function ContactPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); setError(''); setLoading(false); return undefined; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.searchContacts(term);
        if (my !== seq.current) return; // a newer search started — drop this one
        setResults(res.contacts || []);
        setError('');
      } catch (err) {
        if (my === seq.current) { setResults([]); setError(err.message); }
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div style={chip}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{value.name}</div>
          <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[value.email, value.phone].filter(Boolean).join(' · ') || 'No email or phone'}
          </div>
        </div>
        <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px' }}
          onClick={() => { onChange(null); setQ(''); setOpen(true); }}>Change</button>
      </div>
    );
  }

  const term = q.trim();
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" value={q} autoFocus
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on a result land first
        placeholder="Search by name, email or phone" />
      {open && term.length >= 2 && (
        <div style={menu} role="listbox">
          {loading && <div style={menuNote}>Searching…</div>}
          {!loading && error && <div style={{ ...menuNote, color: '#d92d20' }}>{error}</div>}
          {!loading && !error && results.length === 0 && <div style={menuNote}>No contacts match “{term}”.</div>}
          {!loading && !error && results.map((c) => (
            <button key={c.id} type="button" role="option" style={menuItem}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(c); setOpen(false); }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{[c.email, c.phone].filter(Boolean).join(' · ') || '—'}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,41,0.5)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20
};
const chip = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '8px 10px', border: '1px solid var(--border, #e4e7ec)', borderRadius: 8, background: 'var(--surface-2, #f9fafb)'
};
const menu = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 5, maxHeight: 260, overflowY: 'auto',
  background: '#fff', border: '1px solid var(--border, #e4e7ec)', borderRadius: 8, boxShadow: '0 12px 28px rgba(15,23,41,.14)'
};
const menuNote = { padding: '10px 12px', fontSize: 13, color: '#667085' };
const menuItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none',
  borderBottom: '1px solid #f2f4f7', cursor: 'pointer'
};
