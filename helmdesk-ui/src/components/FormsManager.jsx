import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, Switch } from './ui.jsx';
import PortalFormBuilder from './PortalFormBuilder.jsx';

/**
 * Manage multiple public intake forms (Agency plan). Each form has a name, its own fields, an
 * enabled toggle, and a short public URL. Admins create / edit / delete forms; the field editor is
 * the same PortalFormBuilder used before, now per-form.
 *
 * Props: brand (for the live preview), notify(msg, isError).
 */
export default function FormsManager({ brand, notify }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);   // which form is expanded for field editing
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const load = () => api.forms().then((r) => setForms(r.forms || [])).catch((e) => notify?.(e.message, true)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const createForm = async () => {
    setBusy(true);
    try {
      const r = await api.createForm({ name: `Form ${forms.length + 1}` });
      setForms((list) => [...list, r.form]);
      setOpenId(r.form._id);
    } catch (e) { notify?.(e.message, true); }
    finally { setBusy(false); }
  };

  // Debounced-ish save: called on blur / explicit save per form.
  const saveForm = async (form, patch) => {
    const next = { ...form, ...patch };
    setForms((list) => list.map((f) => (f._id === form._id ? next : f)));
    try {
      const r = await api.updateForm(form._id, { name: next.name, enabled: next.enabled, fields: next.fields });
      setForms((list) => list.map((f) => (f._id === form._id ? r.form : f)));
    } catch (e) { notify?.(e.message, true); load(); }
  };

  const removeForm = async (id) => {
    try { await api.deleteForm(id); setForms((list) => list.filter((f) => f._id !== id)); setConfirmId(null); }
    catch (e) { notify?.(e.message, true); }
  };

  const copyUrl = (url) => { navigator.clipboard?.writeText(url).then(() => notify?.('Form link copied.')); };

  if (loading) return <div className="empty"><div className="spinner" style={{ margin: '16px auto' }} /></div>;

  return (
    <div className="forms-mgr">
      <div className="forms-mgr-head">
        <div>
          <div className="t-label">Intake forms</div>
          <div className="t-desc">Create one or more branded forms, each with its own fields and share link.</div>
        </div>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={createForm}>
          <Icon name="plus" size={14} /> New form
        </button>
      </div>

      {forms.length === 0 ? (
        <div className="empty" style={{ padding: '24px 0' }}><strong>No forms yet</strong><p>Create your first intake form to get a shareable link.</p></div>
      ) : forms.map((form) => {
        const open = openId === form._id;
        return (
          <div key={form._id} className={`form-card${open ? ' open' : ''}`}>
            <div className="form-card-head">
              <div className="form-name-wrap" title="Click to rename">
                <input className="form-name" value={form.name} onChange={(e) => setForms((l) => l.map((f) => f._id === form._id ? { ...f, name: e.target.value } : f))}
                  onBlur={(e) => saveForm(form, { name: e.target.value })} placeholder="Form name" />
                <button type="button" className="form-name-edit" title="Rename form"
                  onClick={(e) => e.currentTarget.parentNode.querySelector('.form-name')?.focus()}>
                  <Icon name="pencil" size={14} />
                </button>
              </div>
              <label className="form-enable" title="Enabled">
                <Switch checked={form.enabled !== false} onChange={(v) => saveForm(form, { enabled: v })} />
              </label>
              <button type="button" className="form-edit-btn" onClick={() => setOpenId(open ? null : form._id)}>
                {open ? 'Done' : 'Edit fields'} <Icon name="chevron" size={13} />
              </button>
              <button type="button" className="form-del-btn" title="Delete form" onClick={() => setConfirmId(form._id)}><Icon name="trash" size={14} /></button>
            </div>

            <div className="form-url-row">
              <input type="text" readOnly value={form.url || ''} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-ghost" onClick={() => copyUrl(form.url)}>Copy link</button>
            </div>
            {/* Tells the agency the exact value to match in a workflow filter. The portal trigger sends
                this as `formName`, so "Form name equals <name>" targets submissions of this form. */}
            <div className="form-filter-hint">
              In workflows, filter by <strong>Form name</strong> = <code>{form.name || 'Untitled form'}</code> to act only on this form’s submissions.
            </div>

            {open && (
              <div className="form-fields">
                <PortalFormBuilder value={form.fields} brand={brand}
                  onChange={(pf) => setForms((l) => l.map((f) => f._id === form._id ? { ...f, fields: pf } : f))} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button type="button" className="btn btn-accent" onClick={() => saveForm(form, { fields: form.fields })}>Save fields</button>
                </div>
              </div>
            )}

            {confirmId === form._id && (
              <div className="modal-overlay" onClick={() => setConfirmId(null)}>
                <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                  <h3>Delete “{form.name}”?</h3>
                  <p>Its link will stop working and the form will be removed. This can't be undone.</p>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmId(null)}>Cancel</button>
                    <button type="button" className="btn btn-danger" onClick={() => removeForm(form._id)}>Delete</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
