import React from 'react';
import { Icon, Select, Switch, TagInput } from './ui.jsx';

/**
 * Portal form builder. Edits the workspace's `portalFields` — an ordered list the agency configures
 * for their public intake form. Each field: label, type, required, max length (text), options
 * (choice types), and an optional `maps` to a core ticket attribute (email/subject/…).
 *
 * The default 5 fields (name/email/subject/message/phone) are editable and deletable like any other,
 * so agencies can rename, reorder, or remove them. Props: value (fields[]), onChange(nextFields).
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
  { value: 'message', label: 'Ticket message' }
];
const DEFAULTS = [
  { key: 'name', type: 'text', label: 'Name', required: false, maxLength: 120, options: [], maps: 'name' },
  { key: 'email', type: 'text', label: 'Email', required: false, maxLength: 160, options: [], maps: 'email' },
  { key: 'phone', type: 'text', label: 'Phone (optional)', required: false, maxLength: 40, options: [], maps: 'phone' },
  { key: 'subject', type: 'text', label: 'Subject', required: true, maxLength: 160, options: [], maps: 'subject' },
  { key: 'message', type: 'textarea', label: 'How can we help?', required: true, maxLength: 4000, options: [], maps: 'message' }
];

let idc = 0;
const newKey = () => `field_${Date.now()}_${idc++}`;
const isChoice = (t) => t === 'select' || t === 'radio' || t === 'checkbox';

export default function PortalFormBuilder({ value, onChange }) {
  const fields = Array.isArray(value) && value.length ? value : DEFAULTS;

  const update = (i, patch) => onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const remove = (i) => onChange(fields.filter((_, idx) => idx !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => onChange([...fields, { key: newKey(), type: 'text', label: 'New question', required: false, maxLength: 200, options: [], maps: '' }]);

  return (
    <div className="pfb">
      <div className="pfb-help">Build the form your customers fill in. Drag order with the arrows, edit any field, or add your own questions. The map tells us which fields are the contact’s email, the subject, etc.</div>
      {fields.map((f, i) => (
        <div className="pfb-field" key={f.key || i}>
          <div className="pfb-move">
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><Icon name="chevron" size={14} /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === fields.length - 1} title="Move down"><Icon name="chevron" size={14} /></button>
          </div>
          <div className="pfb-body">
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
                <Select value={f.maps || ''} onChange={(v) => update(i, { maps: v || null })} options={MAPS} />
              </div>
            </div>

            <div className="pfb-row pfb-row-2">
              {!isChoice(f.type) && (
                <div className="field" style={{ margin: 0, flex: 1 }}>
                  <label>Max characters</label>
                  <input type="number" value={f.maxLength || ''} onChange={(e) => update(i, { maxLength: +e.target.value || null })} placeholder="No limit" />
                </div>
              )}
              {isChoice(f.type) && (
                <div className="field" style={{ margin: 0, flex: 2 }}>
                  <label>Options</label>
                  <TagInput value={f.options || []} onChange={(opts) => update(i, { options: opts })} placeholder="Type an option, press Enter…" />
                </div>
              )}
              <div className="pfb-req">
                <span className="pfb-req-label">Required</span>
                <Switch checked={f.required} onChange={(v) => update(i, { required: v })} />
              </div>
            </div>
          </div>
          <button type="button" className="pfb-del" onClick={() => remove(i)} title="Remove field"><Icon name="trash" size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost pfb-add" onClick={add}><Icon name="plus" size={14} /> Add field</button>
    </div>
  );
}
