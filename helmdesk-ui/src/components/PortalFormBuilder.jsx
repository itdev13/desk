import React, { useState } from 'react';
import { Icon, Select, Switch, TagInput } from './ui.jsx';

/**
 * Portal form builder. Edits the workspace's `portalFields` — an ordered list the agency configures
 * for their public intake form. Each field: label, type, placeholder, helpText, required, max length
 * (text), options (choice types), and an optional `maps` to a core ticket attribute (email/subject/…).
 *
 * Left: the editor (drag-to-reorder cards). Right: a live preview of the client-facing form, styled
 * with the agency's brand accent so they see exactly what their customers will.
 * Props: value (fields[]), onChange(nextFields), brand ({ name, color }).
 */

const TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Text area' },
  { value: 'select', label: 'Dropdown (pick one)' },
  { value: 'radio', label: 'Radio (pick one)' },
  { value: 'checkbox', label: 'Checkboxes (pick many)' }
];
const MAPS = [
  { value: '', label: 'Custom question' },
  { value: 'name', label: 'Contact name' },
  { value: 'email', label: 'Contact email' },
  { value: 'phone', label: 'Contact phone' },
  { value: 'subject', label: 'Ticket subject' },
  { value: 'message', label: 'Ticket message' },
  { value: 'priority', label: 'Ticket priority' }
];
// Standard priority options (match the ticket's priority values). Used when a field maps to 'priority'.
const PRIORITY_OPTIONS = ['Low', 'Normal', 'High', 'Urgent'];
const DEFAULTS = [
  { key: 'name', type: 'text', label: 'Name', placeholder: '', helpText: '', required: false, maxLength: 120, options: [], maps: 'name' },
  { key: 'email', type: 'text', label: 'Email', placeholder: '', helpText: '', required: false, maxLength: 160, options: [], maps: 'email' },
  { key: 'phone', type: 'text', label: 'Phone (optional)', placeholder: '', helpText: '', required: false, maxLength: 40, options: [], maps: 'phone' },
  { key: 'subject', type: 'text', label: 'Subject', placeholder: '', helpText: '', required: true, maxLength: 160, options: [], maps: 'subject' },
  { key: 'priority', type: 'select', label: 'Priority', placeholder: '', helpText: 'How urgent is this?', required: false, maxLength: null, options: [...PRIORITY_OPTIONS], maps: 'priority' },
  { key: 'message', type: 'textarea', label: 'How can we help?', placeholder: '', helpText: '', required: true, maxLength: 4000, options: [], maps: 'message' }
];

let idc = 0;
const newKey = () => `field_${Date.now()}_${idc++}`;
const isChoice = (t) => t === 'select' || t === 'radio' || t === 'checkbox';
const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

export default function PortalFormBuilder({ value, onChange, brand }) {
  const fields = Array.isArray(value) && value.length ? value : DEFAULTS;
  const accent = brand?.color || '#E0A24A';
  const brandName = brand?.name || 'HelmDesk';
  const [openIdx, setOpenIdx] = useState(null); // which card is expanded for editing
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const update = (i, patch) => onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i) => { onChange(fields.filter((_, idx) => idx !== i)); setOpenIdx(null); };
  const add = () => {
    onChange([...fields, { key: newKey(), type: 'text', label: 'New question', placeholder: '', helpText: '', required: false, maxLength: 200, options: [], maps: '' }]);
    setOpenIdx(fields.length);
  };
  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    const next = [...fields];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <div className="pfb-wrap">
      {/* ── Editor ──────────────────────────────────────────── */}
      <div className="pfb">
        <div className="pfb-help">Build the form your customers fill in. Drag the handle to reorder, click a field to edit it, or add your own questions.</div>

        {fields.map((f, i) => {
          const open = openIdx === i;
          return (
            <div
              key={f.key || i}
              className={`pfb-card${open ? ' open' : ''}${overIdx === i && dragIdx !== i ? ' drop-target' : ''}${dragIdx === i ? ' dragging' : ''}`}
              draggable={!open}
              onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { e.preventDefault(); if (overIdx !== i) setOverIdx(i); }}
              onDragEnd={() => { reorder(dragIdx, overIdx); setDragIdx(null); setOverIdx(null); }}
              onDrop={(e) => { e.preventDefault(); reorder(dragIdx, overIdx); setDragIdx(null); setOverIdx(null); }}
            >
              {/* collapsed header row */}
              <div className="pfb-card-head" onClick={() => setOpenIdx(open ? null : i)}>
                <span className="pfb-grip" title="Drag to reorder"><Icon name="grip" size={15} /></span>
                <span className="pfb-card-label">{f.label || 'Untitled field'}</span>
                <span className="pfb-card-meta">{TYPE_LABEL[f.type] || f.type}{f.required ? ' · Required' : ''}{f.maps ? ` · ${f.maps}` : ''}</span>
                <span className="pfb-card-chev"><Icon name="chevron" size={14} /></span>
              </div>

              {open && (
                <div className="pfb-card-body">
                  <div className="pfb-row">
                    <div className="field" style={{ margin: 0, flex: 2 }}>
                      <label>Label</label>
                      <input type="text" value={f.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="e.g. Order number" />
                    </div>
                    <div className="field" style={{ margin: 0, flex: 1.4 }}>
                      <label>Type</label>
                      <Select value={f.type} onChange={(v) => update(i, { type: v, options: isChoice(v) ? (f.options?.length ? f.options : ['Option 1']) : [] })} options={TYPES} />
                    </div>
                    <div className="field" style={{ margin: 0, flex: 1.4 }}>
                      <label>Maps to</label>
                      <Select value={f.maps || ''} onChange={(v) => {
                        // Mapping a field to priority turns it into a dropdown with the standard options.
                        if (v === 'priority') update(i, { maps: 'priority', type: 'select', options: (f.options?.length ? f.options : [...PRIORITY_OPTIONS]) });
                        else update(i, { maps: v || null });
                      }} options={MAPS} />
                    </div>
                  </div>

                  {!isChoice(f.type) && (
                    <div className="pfb-row">
                      <div className="field" style={{ margin: 0, flex: 2 }}>
                        <label>Placeholder <span className="pfb-opt">(optional)</span></label>
                        <input type="text" value={f.placeholder || ''} onChange={(e) => update(i, { placeholder: e.target.value })} placeholder="Greyed-out hint inside the field" />
                      </div>
                      <div className="field" style={{ margin: 0, flex: 1 }}>
                        <label>Max characters</label>
                        <input type="number" value={f.maxLength || ''} onChange={(e) => update(i, { maxLength: +e.target.value || null })} placeholder="No limit" />
                      </div>
                    </div>
                  )}

                  {isChoice(f.type) && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Options</label>
                      <TagInput value={f.options || []} onChange={(opts) => update(i, { options: opts })} placeholder="Type an option, press Enter…" />
                    </div>
                  )}

                  <div className="field" style={{ margin: 0 }}>
                    <label>Help text <span className="pfb-opt">(optional)</span></label>
                    <input type="text" value={f.helpText || ''} onChange={(e) => update(i, { helpText: e.target.value })} placeholder="Short guidance shown under the label" />
                  </div>

                  <div className="pfb-card-foot">
                    <div className="pfb-req">
                      <span className="pfb-req-label">Required</span>
                      <Switch checked={f.required} onChange={(v) => update(i, { required: v })} />
                    </div>
                    <button type="button" className="pfb-del" onClick={() => remove(i)}><Icon name="trash" size={14} /> Remove</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" className="btn btn-ghost pfb-add" onClick={add}><Icon name="plus" size={14} /> Add field</button>
      </div>

      {/* ── Live preview ────────────────────────────────────── */}
      <div className="pfb-preview">
        <div className="pfb-preview-label"><Icon name="eye" size={13} /> Live preview</div>
        <div className="pfb-preview-card" style={{ '--pv-accent': accent }}>
          <div className="pfb-pv-head">
            <div className="pfb-pv-title">Submit a request</div>
            <div className="pfb-pv-sub">We’ll get back to you shortly.</div>
          </div>
          {fields.map((f, i) => (
            <div className="pfb-pv-field" key={f.key || i}>
              <div className="pfb-pv-flabel">{f.label || 'Field'}{f.required && <span className="pfb-pv-req"> *</span>}</div>
              {f.helpText && <div className="pfb-pv-help">{f.helpText}</div>}
              {f.type === 'textarea' ? (
                <textarea className="pfb-pv-input" rows={3} placeholder={f.placeholder || ''} disabled />
              ) : f.type === 'select' ? (
                <select className="pfb-pv-input" disabled><option>Select…</option></select>
              ) : f.type === 'radio' || f.type === 'checkbox' ? (
                <div className="pfb-pv-opts">
                  {(f.options?.length ? f.options : ['Option 1']).map((o, oi) => (
                    <label key={oi} className="pfb-pv-opt"><input type={f.type} disabled /> {o}</label>
                  ))}
                </div>
              ) : (
                <input className="pfb-pv-input" placeholder={f.placeholder || ''} disabled />
              )}
            </div>
          ))}
          <button type="button" className="pfb-pv-submit" disabled>Submit</button>
          <div className="pfb-pv-powered">Powered by {brandName}</div>
        </div>
      </div>
    </div>
  );
}
