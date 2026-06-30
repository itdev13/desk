import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Select } from './ui.jsx';

/** Manual ticket creation (Path C). Agent logs a ticket on a customer's behalf. */
export default function NewTicketModal({ onClose, onCreated, notify }) {
  const [form, setForm] = useState({ subject: '', contactName: '', contactEmail: '', channel: 'Email', priority: 'normal', firstMessage: '' });
  const [saving, setSaving] = useState(false);
  const set = (p) => setForm((f) => ({ ...f, ...p }));

  const submit = async () => {
    if (!form.subject.trim() && !form.firstMessage.trim()) { notify('Add a subject or message', true); return; }
    setSaving(true);
    try {
      const res = await api.createTicket(form);
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
          <label>Subject</label>
          <input type="text" value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Brief summary of the issue" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label>Contact name</label><input type="text" value={form.contactName} onChange={(e) => set({ contactName: e.target.value })} /></div>
          <div className="field"><label>Contact email</label><input type="email" value={form.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} /></div>
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
          <button className="btn btn-accent" disabled={saving} onClick={submit}>{saving ? 'Creating…' : 'Create ticket'}</button>
        </div>
      </div>
    </div>
  );
}

const overlay = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,41,0.5)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20
};
