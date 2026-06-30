import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Icon, Switch, Select } from '../components/ui.jsx';
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
  const [providers, setProviders] = useState([]); // [{providerId, name, channel}]

  const [form, setForm] = useState({
    supportChannels: ['Email', 'Live_Chat'],
    supportProviderIds: [],
    ignoreAutomatedReplies: true,
    ignoreShortMessages: false,
    assignmentMode: 'round_robin',
    defaultAssigneeId: null,
    slaTargets: Object.entries(SLA_PRESETS).map(([priority, v]) => ({ priority, ...v })),
    autoCloseResolvedDays: 7,
    autoReplyEnabled: true,
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

    // Sync + load the conversation providers so they can be picked as support sources.
    api.syncProviders()
      .then((r) => setProviders((r.providers || []).filter((p) => !p.deleted)))
      .catch(() => api.providers().then((r) => setProviders((r.providers || []).filter((p) => !p.deleted))).catch(() => {}));


    // Pre-fill from saved settings so a re-run of the wizard (e.g. after reinstall) shows the
    // agency's previous choices to confirm/tweak, rather than resetting to defaults.
    api.getSettings()
      .then((r) => {
        const w = r.workspace || {};
        setForm((f) => ({
          ...f,
          supportChannels: w.supportChannels?.length ? w.supportChannels : f.supportChannels,
          supportProviderIds: w.supportProviderIds || f.supportProviderIds,
          ignoreAutomatedReplies: w.ignoreAutomatedReplies ?? f.ignoreAutomatedReplies,
          ignoreShortMessages: w.ignoreShortMessages ?? f.ignoreShortMessages,
          assignmentMode: w.assignmentMode || f.assignmentMode,
          defaultAssigneeId: w.defaultAssigneeId ?? f.defaultAssigneeId,
          slaTargets: w.slaTargets?.length ? w.slaTargets : f.slaTargets,
          autoCloseResolvedDays: w.autoCloseResolvedDays ?? f.autoCloseResolvedDays,
          autoReplyEnabled: w.autoReplyEnabled ?? f.autoReplyEnabled,
          ticketNumberPrefix: w.ticketNumberPrefix || f.ticketNumberPrefix,
          portalEnabled: w.portalEnabled ?? f.portalEnabled
        }));
      })
      .catch(() => { /* no saved settings yet — keep defaults */ });
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleChannel = (key) =>
    set({ supportChannels: form.supportChannels.includes(key) ? form.supportChannels.filter((c) => c !== key) : [...form.supportChannels, key] });
  const toggleProvider = (id) =>
    set({ supportProviderIds: form.supportProviderIds.includes(id) ? form.supportProviderIds.filter((p) => p !== id) : [...form.supportProviderIds, id] });

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
                <h2>Which channels are support?</h2>
                <p className="lead">Only messages on the channels you pick become tickets. Everything else stays in your inbox untouched.</p>
                <div className="opt-grid" style={{ marginTop: 20 }}>
                  {CHANNELS.map((c) => {
                    const on = form.supportChannels.includes(c.key);
                    return (
                      <button key={c.key} className={`opt ${on ? 'on' : ''}`} onClick={() => toggleChannel(c.key)}>
                        <span className="check">{on && <Icon name="check" size={13} />}</span>
                        {c.label}
                      </button>
                    );
                  })}
                </div>

                {providers.length > 0 && (
                  <>
                    <h2 style={{ fontSize: 16, marginTop: 26 }}>Conversation providers</h2>
                    <p className="lead" style={{ fontSize: 13 }}>
                      Optional. Pick specific providers to only accept messages from them — leave all
                      unchecked to accept every provider on the channels above.
                    </p>
                    <div className="opt-grid" style={{ marginTop: 14 }}>
                      {providers.map((p) => {
                        const on = form.supportProviderIds.includes(p.providerId);
                        return (
                          <button key={p.providerId} className={`opt ${on ? 'on' : ''}`} onClick={() => toggleProvider(p.providerId)}>
                            <span className="check">{on && <Icon name="check" size={13} />}</span>
                            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                              {p.name || p.providerId}
                              <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--slate)' }}>{p.channel}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
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
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <h2>How should tickets be assigned?</h2>
                <p className="lead">Pick how new tickets get an owner. You can change this any time in Settings.</p>
                <div className="opt-grid" style={{ gridTemplateColumns: '1fr', marginTop: 16 }}>
                  {[
                    { key: 'round_robin', label: 'Round-robin', desc: 'Rotate evenly across your active agents.' },
                    { key: 'specific', label: 'Always one agent', desc: 'Send everything to a single owner.' },
                    { key: 'unassigned', label: 'Leave unassigned', desc: 'Agents pick tickets up from the queue.' }
                  ].map((o) => (
                    <button key={o.key} className={`opt ${form.assignmentMode === o.key ? 'on' : ''}`} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }} onClick={() => set({ assignmentMode: o.key })}>
                      <span>{o.label}</span>
                      <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--slate)' }}>{o.desc}</span>
                    </button>
                  ))}
                </div>
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
                <p className="lead">Set how fast you aim to respond. Tickets turn red when a target is about to be missed.</p>
                <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
                  {form.slaTargets.map((t, i) => (
                    <div key={t.priority} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 10, alignItems: 'center' }}>
                      <span className={`pill ${t.priority}`}>{t.priority}</span>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>First reply (min)</label>
                        <input type="number" value={t.firstResponseMins} onChange={(e) => {
                          const v = [...form.slaTargets]; v[i] = { ...t, firstResponseMins: +e.target.value }; set({ slaTargets: v });
                        }} />
                      </div>
                      <div className="field" style={{ margin: 0 }}>
                        <label style={{ fontSize: 11 }}>Resolve (min)</label>
                        <input type="number" value={t.resolveMins} onChange={(e) => {
                          const v = [...form.slaTargets]; v[i] = { ...t, resolveMins: +e.target.value }; set({ slaTargets: v });
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Auto-close resolved after (days)</label>
                    <input type="number" value={form.autoCloseResolvedDays} onChange={(e) => set({ autoCloseResolvedDays: +e.target.value })} />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label>Ticket number prefix</label>
                    <input type="text" value={form.ticketNumberPrefix} onChange={(e) => set({ ticketNumberPrefix: e.target.value })} />
                  </div>
                </div>
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
