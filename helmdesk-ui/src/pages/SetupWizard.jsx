import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Icon, Switch, Select } from '../components/ui.jsx';
import { durationLabel, SlaPreview } from './Settings.jsx';
import { LogoMark } from '../components/Logo.jsx';

/**
 * Settings-first setup wizard. The agency completes four steps before any tickets flow — their
 * choices fully define "what is a support message" so the engine never has to guess. Every field
 * has a sensible default, so they can also click straight through.
 */
const SLA_PRESETS = {
  urgent: { firstResponseMins: 60, resolveMins: 240 },
  high: { firstResponseMins: 240, resolveMins: 480 },
  normal: { firstResponseMins: 480, resolveMins: 1440 },
  low: { firstResponseMins: 1440, resolveMins: 4320 }
};

export default function SetupWizard({ workspace, onDone, notify }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState([]);
  const [routing, setRouting] = useState(true);   // round-robin allowed? (Team+)
  const [planName, setPlanName] = useState('');

  const [form, setForm] = useState({
    // Default: every channel on, so a new workspace captures tickets from everywhere out of the box.
    // The user unticks what they don't want. (On reinstall this is overridden by saved settings.)
    supportChannels: CHANNELS.map((c) => c.key),
    acceptConversationProviders: true,
    ignoreAutomatedReplies: true,
    ignoreShortMessages: false,
    assignmentMode: 'round_robin',
    defaultAssigneeId: null,
    slaTargets: Object.entries(SLA_PRESETS).map(([priority, v]) => ({ priority, ...v })),
    autoCloseResolvedDays: 7,
    reopenWindowDays: 0,
    autoReplyEnabled: true,
    autoReplyMessage: "Thanks for reaching out — we've received your message and a team member will get back to you shortly.",
    ticketNumberPrefix: 'HD-',
    portalEnabled: false
  });

  const [agentsLoaded, setAgentsLoaded] = useState(false);
  useEffect(() => {
    // Pull the agent roster from the users API so "assign to a specific agent" shows real names.
    // Fall back to any already-synced agents; surface a hint if none come back.
    api.syncAgents()
      .then((r) => setAgents(r.agents || []))
      .catch(() => api.agents().then((r) => setAgents(r.agents || [])).catch(() => {}))
      .finally(() => setAgentsLoaded(true));

    // Plan gating + default: round-robin on plans that allow it (Team+), "leave unassigned" on
    // Starter. Only adjust the DEFAULT (round_robin) — never stomp a value a reinstall pre-filled.
    api.subscription().then((s) => {
      const allowed = s.plan?.routing !== false;
      setRouting(allowed);
      setPlanName((s.plan?.name || '').replace(/\s*\(Trial\)\s*$/i, ''));
      if (!allowed) {
        setForm((f) => (f.assignmentMode === 'round_robin' ? { ...f, assignmentMode: 'unassigned' } : f));
      }
    }).catch(() => {});


    // Pre-fill from saved settings so a re-run of the wizard (e.g. after reinstall) shows the
    // agency's previous choices to confirm/tweak. Only do this when the workspace was previously
    // configured (setupComplete) — otherwise a fresh workspace's schema defaults (e.g.
    // acceptConversationProviders:false, supportChannels:[]) would clobber our first-install
    // "select all" defaults.
    api.getSettings()
      .then((r) => {
        const w = r.workspace || {};
        if (!w.setupComplete) return; // true first install → keep the select-all defaults
        setForm((f) => ({
          ...f,
          supportChannels: w.supportChannels?.length ? w.supportChannels : f.supportChannels,
          acceptConversationProviders: w.acceptConversationProviders ?? f.acceptConversationProviders,
          ignoreAutomatedReplies: w.ignoreAutomatedReplies ?? f.ignoreAutomatedReplies,
          ignoreShortMessages: w.ignoreShortMessages ?? f.ignoreShortMessages,
          assignmentMode: w.assignmentMode || f.assignmentMode,
          defaultAssigneeId: w.defaultAssigneeId ?? f.defaultAssigneeId,
          slaTargets: w.slaTargets?.length ? w.slaTargets : f.slaTargets,
          autoCloseResolvedDays: w.autoCloseResolvedDays ?? f.autoCloseResolvedDays,
          reopenWindowDays: w.reopenWindowDays ?? f.reopenWindowDays,
          autoReplyEnabled: w.autoReplyEnabled ?? f.autoReplyEnabled,
          autoReplyMessage: w.autoReplyMessage || f.autoReplyMessage,
          ticketNumberPrefix: w.ticketNumberPrefix || f.ticketNumberPrefix,
          portalEnabled: w.portalEnabled ?? f.portalEnabled
        }));
      })
      .catch(() => { /* no saved settings yet — keep defaults */ });
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleChannel = (key) =>
    set({ supportChannels: form.supportChannels.includes(key) ? form.supportChannels.filter((c) => c !== key) : [...form.supportChannels, key] });

  const steps = ['Channels', 'Filters', 'Assignment', 'SLA & Lifecycle'];
  const canNext = step === 0 ? form.supportChannels.length > 0 : true;

  const finish = async () => {
    setSaving(true);
    try {
      const res = await api.completeSetup(form);
      onDone(res.workspace);
    } catch (err) {
      notify(err.message, true);
      setSaving(false);
    }
  };

  return (
    <div className="wizard-wrap">
      <div className="wizard">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, justifyContent: 'center' }}>
          <LogoMark size={32} />
          <strong style={{ fontSize: 18 }}>HelmDesk setup</strong>
        </div>
        <div className="wizard-card">
          <div className="wizard-head">
            <div className="eyebrow">Step {step + 1} of {steps.length} · {steps[step]}</div>
            <div className="steps">
              {steps.map((_, i) => (
                <div key={i} className={`step-dot ${i < step ? 'done' : i === step ? 'now' : ''}`} />
              ))}
            </div>
          </div>

          <div className="wizard-body">
            {step === 0 && (
              <>
                <h2>Which channels do you support?</h2>
                <p className="lead">Only messages on the channels you pick become tickets. Everything else stays in your inbox untouched.</p>
                {(() => {
                  const allOn = CHANNELS.every((c) => form.supportChannels.includes(c.key)) && form.acceptConversationProviders;
                  return (
                    <div className="opt-selectall">
                      <button type="button" className="link-btn" onClick={() => {
                        if (allOn) set({ supportChannels: [], acceptConversationProviders: false });
                        else set({ supportChannels: CHANNELS.map((c) => c.key), acceptConversationProviders: true });
                      }}>
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                  );
                })()}
                <div className="opt-grid" style={{ marginTop: 12 }}>
                  {CHANNELS.map((c) => {
                    const on = form.supportChannels.includes(c.key);
                    return (
                      <button key={c.key} className={`opt ${on ? 'on' : ''}`} onClick={() => toggleChannel(c.key)}>
                        <span className="check">{on && <Icon name="check" size={13} />}</span>
                        {c.label}
                      </button>
                    );
                  })}
                  {/* Conversation providers as a chip — toggles acceptConversationProviders. */}
                  <button
                    className={`opt ${form.acceptConversationProviders ? 'on' : ''}`}
                    title="Also create tickets from messages sent through a custom conversation provider"
                    onClick={() => set({ acceptConversationProviders: !form.acceptConversationProviders })}
                  >
                    <span className="check">{form.acceptConversationProviders && <Icon name="check" size={13} />}</span>
                    Conversation Providers
                  </button>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <h2>What should we ignore?</h2>
                <p className="lead">Keep the queue clean by filtering out noise that isn't a real support request.</p>
                <div style={{ marginTop: 16 }}>
                  <div className="toggle-row">
                    <div>
                      <div className="t-label">Ignore replies to marketing &amp; automations</div>
                      <div className="t-desc">Recommended. Skips campaign and workflow replies.</div>
                    </div>
                    <Switch checked={form.ignoreAutomatedReplies} onChange={(v) => set({ ignoreAutomatedReplies: v })} />
                  </div>
                  <div className="toggle-row">
                    <div>
                      <div className="t-label">Ignore one-word messages</div>
                      <div className="t-desc">Skips "ok", "thanks", "👍" and similar acknowledgements.</div>
                    </div>
                    <Switch checked={form.ignoreShortMessages} onChange={(v) => set({ ignoreShortMessages: v })} />
                  </div>
                  <div className="toggle-row">
                    <div>
                      <div className="t-label">Auto-reply on new tickets</div>
                      <div className="t-desc">Send "we received your request" to the customer automatically.</div>
                    </div>
                    <Switch checked={form.autoReplyEnabled} onChange={(v) => set({ autoReplyEnabled: v })} />
                  </div>
                  {form.autoReplyEnabled && (
                    <div className="field" style={{ marginTop: 14 }}>
                      <label>Auto-reply message</label>
                      <textarea value={form.autoReplyMessage}
                        onChange={(e) => set({ autoReplyMessage: e.target.value })}
                        placeholder="Thanks for reaching out — we've received your message and will get back to you shortly." />
                      <span className="hint">Sent automatically to the customer when a new ticket is created.</span>
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2>How should tickets be assigned?</h2>
                <p className="lead">Pick how new tickets get an owner. You can change this any time in Settings.</p>
                <div className="opt-grid" style={{ gridTemplateColumns: '1fr', marginTop: 16 }}>
                  {[
                    { key: 'round_robin', label: 'Round-robin', desc: 'Rotate evenly across your active agents.', locked: !routing },
                    { key: 'specific', label: 'Always one agent', desc: 'Send everything to a single owner.' },
                    { key: 'unassigned', label: 'Leave unassigned', desc: 'Agents pick tickets up from the queue.' }
                  ].map((o) => (
                    <button key={o.key} disabled={o.locked}
                      className={`opt ${form.assignmentMode === o.key && !o.locked ? 'on' : ''} ${o.locked ? 'is-locked' : ''}`}
                      style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                      onClick={() => !o.locked && set({ assignmentMode: o.key })}>
                      <span>{o.label}{o.locked && <span className="opt-tag">Team plan</span>}</span>
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--slate)' }}>{o.desc}</span>
                    </button>
                  ))}
                </div>
                {!routing && (
                  <div className="plan-lock" style={{ marginTop: 12, marginBottom: 0 }}>
                    <Icon name="route" size={16} />
                    <span>Round-robin auto-assignment is a <b>Team plan</b> feature. On {planName || 'your plan'}, assign to one agent or leave unassigned — you can upgrade later in Settings.</span>
                  </div>
                )}
                {form.assignmentMode === 'specific' && (
                  <div className="field" style={{ marginTop: 14 }}>
                    <label>Assign all tickets to</label>
                    <Select
                      value={form.defaultAssigneeId || ''}
                      onChange={(v) => set({ defaultAssigneeId: v || null })}
                      placeholder="Select an agent…"
                      options={agents.map((a) => ({ value: a.ghlUserId, label: a.name }))}
                    />
                    {agentsLoaded && agents.length === 0 && (
                      <span className="hint" style={{ color: 'var(--warn)' }}>
                        No team members found yet.{' '}
                        <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '2px 8px' }}
                          onClick={() => api.syncAgents().then((r) => setAgents(r.agents || [])).catch(() => notify('Could not load your team — try again in a moment.', true))}>
                          Retry sync
                        </button>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <h2>Response targets &amp; lifecycle</h2>
                <p className="lead">How fast you aim to reply and resolve, per priority (in minutes). Tickets turn red when a target is about to be missed.</p>
                <div className="sla-grid" style={{ marginTop: 16 }}>
                  <div className="sla-grid-head">
                    <span className="col-lbl">Priority</span>
                    <span className="col-lbl">First response</span>
                    <span className="col-lbl">Resolve</span>
                  </div>
                  {form.slaTargets.map((t, i) => (
                    <div key={t.priority} className="sla-row">
                      <span className={`pill ${t.priority}`}>{t.priority}</span>
                      <div className="sla-input-wrap">
                        <input type="number" value={t.firstResponseMins} onChange={(e) => {
                          const v = [...form.slaTargets]; v[i] = { ...t, firstResponseMins: +e.target.value }; set({ slaTargets: v });
                        }} />
                        <span className="unit">{durationLabel(t.firstResponseMins)}</span>
                      </div>
                      <div className="sla-input-wrap">
                        <input type="number" value={t.resolveMins} onChange={(e) => {
                          const v = [...form.slaTargets]; v[i] = { ...t, resolveMins: +e.target.value }; set({ slaTargets: v });
                        }} />
                        <span className="unit">{durationLabel(t.resolveMins)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginTop: 18 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Auto-close resolved after (days)</label>
                    <input type="number" value={form.autoCloseResolvedDays} onChange={(e) => set({ autoCloseResolvedDays: +e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Reopen resolved within</label>
                    <Select
                      value={String(form.reopenWindowDays)}
                      onChange={(v) => set({ reopenWindowDays: +v })}
                      options={[
                        { value: '0', label: 'Never — new ticket' },
                        { value: '3', label: '3 days' },
                        { value: '7', label: '7 days' },
                        { value: '14', label: '14 days' },
                        { value: '30', label: '30 days' }
                      ]}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Ticket number prefix</label>
                    <input type="text" value={form.ticketNumberPrefix} onChange={(e) => set({ ticketNumberPrefix: e.target.value })} />
                  </div>
                </div>
                <SlaPreview targets={form.slaTargets} />
                <div className="toggle-row" style={{ marginTop: 10 }}>
                  <div>
                    <div className="t-label">Enable client portal intake</div>
                    <div className="t-desc">Let customers submit tickets from a branded web form.</div>
                  </div>
                  <Switch checked={form.portalEnabled} onChange={(v) => set({ portalEnabled: v })} />
                </div>
              </>
            )}
          </div>

          <div className="wizard-foot">
            <button className="btn btn-ghost" disabled={step === 0 || saving} onClick={() => setStep((s) => s - 1)}>Back</button>
            {step < steps.length - 1 ? (
              <button className="btn btn-primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Continue</button>
            ) : (
              <button className="btn btn-accent" disabled={saving} onClick={finish}>
                {saving ? 'Going live…' : 'Finish setup → Go live'}
              </button>
            )}
          </div>
        </div>
        {step === 0 && form.supportChannels.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--slate)', fontSize: 12.5, marginTop: 12 }}>Pick at least one channel to continue.</p>
        )}
      </div>
    </div>
  );
}
