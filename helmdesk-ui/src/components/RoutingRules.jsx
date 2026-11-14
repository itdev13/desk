import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Icon, Switch, Select, SectionHeader } from './ui.jsx';

/**
 * Settings → Routing rules. Admins build "When <form answer / channel / keyword> → assign to <agent>
 * and/or set <priority>" rules. Rules run top-to-bottom when a ticket is created; the first rule to set
 * each action wins, and a matching rule overrides the normal assignment mode above.
 *
 * Form questions come from the location's intake forms (custom questions only — core fields like
 * name/email aren't stored as answers), so admins pick a question and one of its options instead of
 * typing labels that must match exactly.
 */
const PRIORITIES = [
  { value: '', label: "Don't change" },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' }
];

const blankRule = (n) => ({
  name: `Rule ${n}`, enabled: true,
  matchFormId: '', matchField: '', matchOp: 'is', matchValues: [], matchValue: '', matchChannel: '', matchKeyword: '',
  assignAgentId: '', setPriority: ''
});

const CHOICE_TYPES = ['select', 'radio', 'checkbox'];
const hasValue = (r) => (r.matchOp === 'contains' ? !!String(r.matchValue || '').trim() : (r.matchValues || []).length > 0 || !!r.matchValue);

function ruleProblem(r) {
  const formCond = !!r.matchFormId || (r.matchField && hasValue(r));
  if (r.matchField && !hasValue(r)) {
    return r.matchOp === 'contains' ? 'Type the words to look for in this answer.' : 'Tick at least one answer.';
  }
  if (!formCond && !r.matchChannel && !r.matchKeyword) return 'Add a condition — this rule won’t be saved without one.';
  if (!r.assignAgentId && !r.setPriority) return 'Pick an agent or a priority — this rule won’t be saved without an action.';
  return null;
}

export default function RoutingRules({ rules = [], onChange, agents = [], portalFields = [] }) {
  const [forms, setForms] = useState([]);
  useEffect(() => { api.forms().then((r) => setForms(r.forms || [])).catch(() => {}); }, []);

  // Forms an admin can pick: every saved intake form, plus the workspace's built-in form when it has
  // custom questions. Each carries its CUSTOM questions only (name/email/phone/etc. aren't stored as
  // answers, so they can't be matched).
  const formList = useMemo(() => {
    const custom = (fields) => (fields || []).filter((f) => f && !f.maps && f.label)
      .map((f) => ({ label: f.label.trim(), type: f.type || 'text', options: (f.options || []).filter(Boolean) }));
    const list = forms.map((f) => ({ id: String(f._id), name: f.name || 'Untitled form', questions: custom(f.fields) }));
    const def = custom(portalFields);
    if (def.length) list.push({ id: 'default', name: 'Default form', questions: def });
    return list;
  }, [forms, portalFields]);

  // Questions for a rule: the chosen form's, or (Any form) every form's, merged by label.
  const questionsFor = (formId) => {
    const src = formId ? formList.filter((f) => f.id === formId) : formList;
    const map = new Map();
    for (const f of src) {
      for (const q of f.questions) {
        const key = q.label.toLowerCase();
        const cur = map.get(key) || { ...q, options: [] };
        if (CHOICE_TYPES.includes(q.type)) cur.type = q.type;
        for (const o of q.options) if (!cur.options.includes(o)) cur.options.push(o);
        map.set(key, cur);
      }
    }
    return [...map.values()];
  };

  const agentOptions = [
    { value: '', label: "Don't change" },
    ...agents.map((a) => ({ value: a.ghlUserId, label: a.email ? `${a.name || 'Agent'} (${a.email})` : (a.name || 'Agent') }))
  ];

  const update = (i, patch) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rules.filter((_, j) => j !== i));
  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="card">
      <div className="section-head-row">
        <SectionHeader icon="route" title="Routing rules"
          description="Send new tickets to the right person automatically. Pick a form and one of its questions — e.g. when “Department” is “Billing”, assign to your billing lead. Rules run top to bottom and override the assignment mode above." />
        <button type="button" className="btn btn-ghost" onClick={() => onChange([...rules, blankRule(rules.length + 1)])}>
          <Icon name="plus" size={14} /> Add rule
        </button>
      </div>

      {rules.length === 0 && (
        <div className="muted" style={{ fontSize: 13, padding: '14px 0 4px' }}>
          No rules yet. New tickets follow the assignment mode above.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
        {rules.map((r, i) => {
          const questions = questionsFor(r.matchFormId);
          const q = questions.find((x) => x.label.toLowerCase() === String(r.matchField || '').toLowerCase());
          const isChoice = q ? CHOICE_TYPES.includes(q.type) && q.options.length > 0 : r.matchOp !== 'contains';
          const formOptions = [
            { value: '', label: 'Any form' },
            ...formList.map((f) => ({ value: f.id, label: f.name })),
            ...(r.matchFormId && !formList.some((f) => f.id === r.matchFormId) ? [{ value: r.matchFormId, label: 'Deleted form' }] : [])
          ];
          const questionOptions = [
            { value: '', label: 'Any question' },
            ...questions.map((x) => ({ value: x.label, label: x.label, meta: CHOICE_TYPES.includes(x.type) && x.options.length ? 'Choice' : 'Text' })),
            ...(r.matchField && !q ? [{ value: r.matchField, label: `${r.matchField} (not on this form)` }] : [])
          ];
          const selected = r.matchValues && r.matchValues.length ? r.matchValues : (r.matchValue && r.matchOp !== 'contains' ? [r.matchValue] : []);
          const toggleValue = (v) => {
            const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
            update(i, { matchOp: 'is', matchValues: next, matchValue: '' });
          };
          const problem = ruleProblem(r);
          return (
            <div key={i} style={{ ...ruleBox, opacity: r.enabled === false ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={orderBadge}>{i + 1}</span>
                <input type="text" value={r.name || ''} onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Rule name" style={{ flex: 1, fontWeight: 600 }} aria-label="Rule name" />
                <button type="button" className="btn btn-ghost" style={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">↑</button>
                <button type="button" className="btn btn-ghost" style={iconBtn} disabled={i === rules.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">↓</button>
                <Switch checked={r.enabled !== false} onChange={(v) => update(i, { enabled: v })} />
                <button type="button" className="btn btn-ghost" style={iconBtn} onClick={() => remove(i)} title="Delete rule" aria-label="Delete rule">
                  <Icon name="trash" size={15} />
                </button>
              </div>

              <div style={label}>When</div>
              <div style={grid2}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Form</label>
                  <Select value={r.matchFormId || ''} searchable
                    onChange={(v) => update(i, { matchFormId: v, matchField: '', matchValues: [], matchValue: '', matchOp: 'is' })}
                    options={formOptions} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Question</label>
                  <Select value={r.matchField || ''} searchable
                    onChange={(v) => {
                      const nq = questions.find((x) => x.label === v);
                      const choice = nq && CHOICE_TYPES.includes(nq.type) && nq.options.length > 0;
                      update(i, { matchField: v, matchOp: choice || !v ? 'is' : 'contains', matchValues: [], matchValue: '' });
                    }}
                    placeholder={questions.length ? 'Select a question…' : 'No custom questions on this form'}
                    options={questionOptions} />
                </div>
              </div>

              {r.matchField && (isChoice ? (
                <div className="field" style={{ margin: 0 }}>
                  <label>Answer is any of</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {[...(q?.options || []), ...selected.filter((v) => !(q?.options || []).includes(v))].map((o) => {
                      const on = selected.includes(o);
                      const gone = q && !q.options.includes(o);
                      return (
                        <button key={o} type="button" className={`opt ${on ? 'on' : ''}`} onClick={() => toggleValue(o)}
                          title={gone ? 'No longer an option on this question' : undefined}>
                          <span className="check">{on && <Icon name="check" size={13} />}</span>{o}{gone ? ' (removed)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="field" style={{ margin: 0 }}>
                  <label>Answer contains</label>
                  <input type="text" value={r.matchValue || ''}
                    onChange={(e) => update(i, { matchOp: 'contains', matchValue: e.target.value, matchValues: [] })}
                    placeholder="e.g. refund, chargeback" />
                  <span className="hint">Separate with commas to match any of several words.</span>
                </div>
              ))}

              <div style={grid2}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Channel <span className="muted">(optional)</span></label>
                  <Select value={r.matchChannel || ''} onChange={(v) => update(i, { matchChannel: v })}
                    options={[{ value: '', label: 'Any channel' }, { value: 'portal', label: 'Form' },
                      ...CHANNELS.map((c) => ({ value: c.key, label: c.label }))]} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Message contains <span className="muted">(optional)</span></label>
                  <input type="text" value={r.matchKeyword || ''} onChange={(e) => update(i, { matchKeyword: e.target.value })}
                    placeholder="e.g. refund" />
                </div>
              </div>

              <div style={label}>Then</div>
              <div style={grid2}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Assign to</label>
                  <Select value={r.assignAgentId || ''} searchable onChange={(v) => update(i, { assignAgentId: v })}
                    options={[
                      ...agentOptions,
                      ...(r.assignAgentId && !agents.some((a) => a.ghlUserId === r.assignAgentId)
                        ? [{ value: r.assignAgentId, label: 'Removed agent — pick another' }] : [])
                    ]} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Set priority</label>
                  <Select value={r.setPriority || ''} onChange={(v) => update(i, { setPriority: v })} options={PRIORITIES} />
                </div>
              </div>

              {problem && <div style={warn}>{problem}</div>}
            </div>
          );
        })}
      </div>

      {rules.length > 0 && (
        <span className="hint" style={{ display: 'block', marginTop: 12 }}>
          All conditions in a rule must match. Answers are compared ignoring upper/lower case. Click <b>Save</b> to apply.
        </span>
      )}
    </div>
  );
}

const ruleBox = {
  border: '1px solid var(--border, #e4e7ec)', borderRadius: 10, padding: 14,
  background: 'var(--surface-2, #fafbfc)', display: 'flex', flexDirection: 'column', gap: 10
};
const orderBadge = {
  flex: 'none', width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center',
  fontSize: 12, fontWeight: 700, background: 'var(--accent-soft, #fbefdc)', color: 'var(--accent-ink, #8a5a12)'
};
const iconBtn = { padding: '4px 8px', minWidth: 30 };
const label = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#667085', marginTop: 4 };
const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 };
const warn = { fontSize: 12.5, color: '#b54708', background: '#fffaeb', border: '1px solid #fedf89', borderRadius: 6, padding: '6px 10px' };
