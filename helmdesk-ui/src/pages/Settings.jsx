import React, { useEffect, useState } from 'react';
import { api, portalUrl } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Icon, Switch, Select, TagInput, SectionHeader, ColorField } from '../components/ui.jsx';
import PortalFormBuilder from '../components/PortalFormBuilder.jsx';
import { track } from '../lib/analytics.js';

/** Render a minutes value as a friendly duration, e.g. 60 → "1h", 1440 → "1d", 90 → "1h 30m". */
export function durationLabel(mins) {
  const n = Number(mins);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return `${n}m`;
  const h = Math.floor(n / 60), m = n % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24), rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Plain-English SLA line for one priority row, e.g. "Urgent → first reply within 2m, resolve within 4h". */
export function slaSentence(t) {
  const label = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }[t.priority] || t.priority;
  const fr = durationLabel(t.firstResponseMins), rz = durationLabel(t.resolveMins);
  return { label, priority: t.priority, first: fr || '—', resolve: rz || '—' };
}

/**
 * Live preview strip: one readable line per priority, updates as the targets are edited.
 * `collapsible` renders it behind an ⓘ toggle (collapsed by default) — used in the wizard where
 * space is tight; Settings shows it fully expanded.
 */
export function SlaPreview({ targets, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="sla-preview">
      {collapsible ? (
        <button type="button" className="sla-preview-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="info-dot">i</span>
          <span>What these targets mean, in plain English</span>
          <Icon name="chevron" size={15} />
        </button>
      ) : (
        <div className="sla-preview-title">In plain English</div>
      )}
      {open && (<>
      <ul className="sla-preview-list" style={collapsible ? { marginTop: 12 } : undefined}>
        {targets.map((t) => {
          const s = slaSentence(t);
          return (
            <li key={t.priority}>
              <span className={`dot ${s.priority}`} />
              <strong>{s.label}</strong>
              <span>tickets: first reply within <b>{s.first}</b>, resolve within <b>{s.resolve}</b>.</span>
            </li>
          );
        })}
      </ul>
      <div className="sla-preview-note">
        <div className="sla-preview-note-title">What happens when a target is missed</div>
        <ul>
          <li><b>First-response target</b> — the clock stops the moment an agent sends the first reply. If it isn't met in time, the ticket is flagged <em>breached</em>.</li>
          <li><b>Resolve target</b> — measured until the ticket is marked <em>Resolved</em>. Miss it and the ticket is flagged <em>breached</em>.</li>
          <li>Clocks <b>pause</b> while a ticket is <em>Pending / On hold</em> (waiting on the customer), so you're never penalised for their response time.</li>
          <li>A breached ticket turns <b>red</b>, surfaces under the <b>Overdue</b> filter, and drops out of your <b>In-SLA %</b>. It's a visibility flag only — nothing is auto-closed or reassigned.</li>
        </ul>
      </div>
      </>)}
    </div>
  );
}

/**
 * Reusable "what is what" reference card, styled like the SLA plain-English block. `items` is a
 * list of { term, desc } — the term is bolded, the description explains what that setting does.
 */
export function InfoPanel({ title = 'What each setting does', items = [] }) {
  return (
    <div className="sla-preview">
      <div className="sla-preview-note" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
        <div className="sla-preview-note-title">{title}</div>
        <ul>
          {items.map((it, i) => (
            <li key={i}><b>{it.term}</b> — {it.desc}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Post-setup configuration. Same fields the wizard collected, plus white-label brand + portal. */
export default function Settings({ onSaved, notify, onNavPlan }) {
  const [ws, setWs] = useState(null);
  const [agents, setAgents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('channels');
  const [whiteLabel, setWhiteLabel] = useState(true); // gates the branding tab; assume allowed until known
  const [routing, setRouting] = useState(true); // gates round-robin; assume allowed until known
  const [planName, setPlanName] = useState('');

  useEffect(() => {
    api.getSettings().then((r) => setWs(r.workspace)).catch((e) => notify(e.message, true));
    api.assignableAgents().then((r) => setAgents(r.agents || [])).catch(() => {});
    api.subscription().then((s) => {
      setWhiteLabel(s.plan?.whiteLabel !== false);
      setRouting(s.plan?.routing !== false);
      setPlanName((s.plan?.name || '').replace(/\s*\(Trial\)\s*$/i, ''));
    }).catch(() => {});
  }, [notify]);

  if (!ws) return (<><div className="topbar"><h1>Settings</h1></div><div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div></>);

  const set = (patch) => setWs((w) => ({ ...w, ...patch }));
  const toggleChannel = (key) =>
    set({ supportChannels: ws.supportChannels.includes(key) ? ws.supportChannels.filter((c) => c !== key) : [...ws.supportChannels, key] });

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.updateSettings({
        supportChannels: ws.supportChannels,
        acceptConversationProviders: ws.acceptConversationProviders,
        ignoreAutomatedReplies: ws.ignoreAutomatedReplies,
        ignoreShortMessages: ws.ignoreShortMessages,
        skipKeywords: ws.skipKeywords || [],
        createKeywords: ws.createKeywords || [],
        assignmentMode: ws.assignmentMode,
        defaultAssigneeId: ws.defaultAssigneeId,
        slaTargets: ws.slaTargets,
        autoCloseResolvedDays: ws.autoCloseResolvedDays,
        reopenWindowDays: ws.reopenWindowDays,
        autoReplyEnabled: ws.autoReplyEnabled,
        autoReplyMessage: ws.autoReplyMessage,
        ticketNumberPrefix: ws.ticketNumberPrefix,
        brand: ws.brand,
        portalEnabled: ws.portalEnabled,
        portalFields: ws.portalFields
      });
      setWs(res.workspace);
      onSaved?.(res.workspace);
      track('settings_saved', { tab });
      notify('Settings saved');
    } catch (err) {
      track('settings_save_blocked', { tab, code: err.code });
      notify(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: 'channels', label: 'Channels & filters', icon: 'filter' },
    { key: 'assignment', label: 'Assignment & SLA', icon: 'route' },
    { key: 'brand', label: 'Branding & portal', icon: 'palette' }
  ];

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>
      <div className="page">
        <div className="filters">
          {tabs.map((t) => (
            <button key={t.key} className={`chip chip-icon ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              <Icon name={t.icon} size={15} /> {t.label}
            </button>
          ))}
        </div>

        {tab === 'channels' && (
          <div className="card">
            <div className="section-head-row">
              <SectionHeader icon="filter" title="Support channels"
                description="Only messages on the channels you pick become tickets — everything else stays in your inbox untouched." />
              {(() => {
                const allOn = CHANNELS.every((c) => ws.supportChannels.includes(c.key)) && ws.acceptConversationProviders;
                return (
                  <button type="button" className="link-btn" onClick={() => {
                    if (allOn) set({ supportChannels: [], acceptConversationProviders: false });
                    else set({ supportChannels: CHANNELS.map((c) => c.key), acceptConversationProviders: true });
                  }}>
                    {allOn ? 'Clear all' : 'Select all'}
                  </button>
                );
              })()}
            </div>
            <div className="opt-grid">
              {CHANNELS.map((c) => {
                const on = ws.supportChannels.includes(c.key);
                return (
                  <button key={c.key} className={`opt ${on ? 'on' : ''}`} onClick={() => toggleChannel(c.key)}>
                    <span className="check">{on && <Icon name="check" size={13} />}</span>{c.label}
                  </button>
                );
              })}
              {/* Conversation providers as a chip: toggles acceptConversationProviders, not a channel. */}
              <button
                className={`opt ${ws.acceptConversationProviders ? 'on' : ''}`}
                title="Also create tickets from messages sent through a custom conversation provider"
                onClick={() => set({ acceptConversationProviders: !ws.acceptConversationProviders })}
              >
                <span className="check">{ws.acceptConversationProviders && <Icon name="check" size={13} />}</span>Conversation Providers
              </button>
            </div>
            <div style={{ marginTop: 18 }}>
              <div className="toggle-row">
                <div><div className="t-label">Ignore marketing &amp; automation replies</div><div className="t-desc">Keeps campaign replies out of the queue.</div></div>
                <Switch checked={ws.ignoreAutomatedReplies} onChange={(v) => set({ ignoreAutomatedReplies: v })} />
              </div>
              <div className="toggle-row">
                <div><div className="t-label">Ignore one-word messages</div><div className="t-desc">Skips "ok", "thanks" and similar.</div></div>
                <Switch checked={ws.ignoreShortMessages} onChange={(v) => set({ ignoreShortMessages: v })} />
              </div>
              <div className="toggle-row">
                <div><div className="t-label">Auto-reply on new tickets</div><div className="t-desc">Acknowledge the customer automatically.</div></div>
                <Switch checked={ws.autoReplyEnabled} onChange={(v) => set({ autoReplyEnabled: v })} />
              </div>
              {ws.autoReplyEnabled && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Auto-reply message</label>
                  <textarea value={ws.autoReplyMessage} onChange={(e) => set({ autoReplyMessage: e.target.value })}
                    placeholder="Thanks for reaching out — we've received your message and will get back to you shortly." />
                  <span className="hint">Sent automatically to the customer when a new ticket is created.</span>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Always create a ticket if message contains</label>
                <TagInput
                  value={ws.createKeywords || []}
                  onChange={(tags) => set({ createKeywords: tags })}
                  placeholder="help, broken, urgent…"
                />
                <span className="hint">Press Enter to add each keyword. Forces a ticket even if the filters above would skip it.</span>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Never create a ticket if message contains</label>
                <TagInput
                  value={ws.skipKeywords || []}
                  onChange={(tags) => set({ skipKeywords: tags })}
                  placeholder="unsubscribe, stop, opt out…"
                />
                <span className="hint">Press Enter to add each keyword. These win over everything — no ticket is created.</span>
              </div>
            </div>
          </div>
        )}


        {tab === 'assignment' && (
          <div className="card">
            <SectionHeader icon="route" title="Assignment"
              description="How new tickets get an owner when they're created." />
            <div className="field">
              <label>Mode</label>
              <Select
                value={ws.assignmentMode}
                onChange={(v) => set({ assignmentMode: v })}
                options={[
                  { value: 'round_robin', label: 'Round-robin across active agents', disabled: !routing, meta: routing ? undefined : 'Team plan' },
                  { value: 'specific', label: 'Always one agent' },
                  { value: 'unassigned', label: 'Leave unassigned' }
                ]}
              />
              {!routing && (
                <div className="plan-lock" style={{ marginTop: 10, marginBottom: 0 }}>
                  <Icon name="route" size={16} />
                  <span>Round-robin auto-assignment is a <b>Team plan</b> feature. On {planName || 'your current plan'}, assign to one agent or leave unassigned. <button type="button" className="link-btn" onClick={() => onNavPlan?.()}>Switch plan →</button></span>
                </div>
              )}
            </div>
            {ws.assignmentMode === 'specific' && (
              <div className="field">
                <label>Default agent</label>
                <Select
                  value={ws.defaultAssigneeId || ''}
                  onChange={(v) => set({ defaultAssigneeId: v || null })}
                  placeholder="Select an agent…"
                  options={agents.map((a) => ({ value: a.ghlUserId, label: a.name }))}
                />
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <SectionHeader icon="clock" title="Response targets (SLA)"
                description="How fast you aim to reply and resolve, per priority. Tickets turn red when a target is about to be missed. Values are in minutes." />
            </div>
            <div className="sla-grid">
              <div className="sla-grid-head">
                <span className="col-lbl">Priority</span>
                <span className="col-lbl">First response</span>
                <span className="col-lbl">Resolve</span>
              </div>
              {ws.slaTargets.map((t, i) => (
                <div key={t.priority} className="sla-row">
                  <span className={`pill ${t.priority}`}>{t.priority}</span>
                  <div className="sla-input-wrap">
                    <input type="number" value={t.firstResponseMins} onChange={(e) => { const v = [...ws.slaTargets]; v[i] = { ...t, firstResponseMins: +e.target.value }; set({ slaTargets: v }); }} />
                    <span className="unit">{durationLabel(t.firstResponseMins)}</span>
                  </div>
                  <div className="sla-input-wrap">
                    <input type="number" value={t.resolveMins} onChange={(e) => { const v = [...ws.slaTargets]; v[i] = { ...t, resolveMins: +e.target.value }; set({ slaTargets: v }); }} />
                    <span className="unit">{durationLabel(t.resolveMins)}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <SectionHeader icon="hash" title="Ticket lifecycle"
                description="What happens after a ticket is resolved, and how ticket numbers look." />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div className="field" style={{ margin: 0 }}><label>Auto-close resolved (days)</label><input type="number" value={ws.autoCloseResolvedDays} onChange={(e) => set({ autoCloseResolvedDays: +e.target.value })} /><span className="hint">0 = never auto-close.</span></div>
              <div className="field" style={{ margin: 0 }}>
                <label>Reopen resolved within</label>
                <Select
                  value={String(ws.reopenWindowDays ?? 0)}
                  onChange={(v) => set({ reopenWindowDays: +v })}
                  options={[
                    { value: '0', label: 'Never — always new ticket' },
                    { value: '3', label: '3 days' },
                    { value: '7', label: '7 days' },
                    { value: '14', label: '14 days' },
                    { value: '30', label: '30 days' }
                  ]}
                />
                <span className="hint">A reply within this window reopens the resolved ticket instead of creating a new one.</span>
              </div>
              <div className="field" style={{ margin: 0 }}><label>Ticket number prefix</label><input type="text" value={ws.ticketNumberPrefix} onChange={(e) => set({ ticketNumberPrefix: e.target.value })} /></div>
            </div>
          </div>
        )}

        {tab === 'brand' && (
          <div className="card">
            <SectionHeader icon="palette" title="White-label branding"
              description="Make the app your own when you resell it to clients — set the brand name, color, and a public intake form." />
            {!whiteLabel && (
              <div className="plan-lock">
                <Icon name="palette" size={16} />
                <span>White-label branding & the client portal are an <b>Agency plan</b> feature. <button type="button" className="link-btn" onClick={() => onNavPlan?.()}>Switch plan →</button></span>
              </div>
            )}
            <fieldset disabled={!whiteLabel} style={{ border: 'none', padding: 0, margin: 0, opacity: whiteLabel ? 1 : 0.55 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="field" style={{ margin: 0 }}><label>Brand name</label><input type="text" value={ws.brand?.name || ''} onChange={(e) => set({ brand: { ...ws.brand, name: e.target.value } })} /></div>
              <div className="field" style={{ margin: 0 }}>
                <label>Primary color</label>
                <ColorField value={ws.brand?.primaryColor || ''} onChange={(v) => set({ brand: { ...ws.brand, primaryColor: v } })} />
              </div>
            </div>
            <div className="toggle-row" style={{ marginTop: 14 }}>
              <div><div className="t-label">Client portal intake</div><div className="t-desc">Let customers submit tickets from a branded web form.</div></div>
              <Switch checked={ws.portalEnabled} onChange={(v) => set({ portalEnabled: v })} />
            </div>
            {ws.portalEnabled && ws.portalSlug && (
              <div className="field" style={{ marginTop: 12 }}>
                <label>Public intake URL</label>
                <input type="text" readOnly value={portalUrl(ws.portalSlug)} onFocus={(e) => e.target.select()} />
                <span className="hint">Share or embed this on the client's site.</span>
              </div>
            )}
            {ws.portalEnabled && (
              <div style={{ marginTop: 18 }}>
                <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 8 }}>Intake form fields</label>
                <PortalFormBuilder value={ws.portalFields} onChange={(pf) => set({ portalFields: pf })} />
              </div>
            )}
            </fieldset>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
          <button className="btn btn-accent" disabled={saving} onClick={save}>
            <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Reference info sits below the save action — it's read-only guidance, not a setting. */}
        {tab === 'channels' && (
          <InfoPanel
            title="What each setting does"
            items={[
              { term: 'Support channels', desc: 'Only messages arriving on the channels you tick become tickets. Everything else stays in your inbox and is ignored by the helpdesk.' },
              { term: 'Conversation Providers', desc: 'Also turn messages from a custom conversation provider into tickets — useful for channels not in the standard list.' },
              { term: 'Ignore marketing & automation replies', desc: 'Skips replies generated by campaigns, workflows and bulk actions, so automated blasts don’t create noise tickets.' },
              { term: 'Ignore one-word messages', desc: 'Skips throwaway replies like “ok” or “thanks” that don’t need a ticket.' },
              { term: 'Auto-reply on new tickets', desc: 'Sends the customer an automatic acknowledgement the moment a ticket is created, on the same channel.' },
              { term: 'Always create / Never create keywords', desc: 'Keyword overrides. “Always” forces a ticket even if a filter would skip it; “Never” blocks a ticket entirely. Never-create always wins.' }
            ]}
          />
        )}
        {tab === 'assignment' && <SlaPreview targets={ws.slaTargets} />}
        {tab === 'brand' && (
          <InfoPanel
            title="What each setting does"
            items={[
              { term: 'Brand name', desc: 'Replaces “HelmDesk” across the app your clients see — the top-left name and page titles.' },
              { term: 'Primary color', desc: 'The accent color used for buttons and highlights, so the app matches your agency’s branding.' },
              { term: 'Client portal intake', desc: 'Turns on a public, branded web form where customers can submit tickets directly — no channel message needed.' },
              { term: 'Public intake URL', desc: 'The shareable link to that form. Share it or embed it on your client’s website.' },
              { term: 'Availability', desc: 'Branding and the portal are an Agency-plan feature. On lower plans these controls are locked.' }
            ]}
          />
        )}

        {/* Data-retention policy — shown on every tab so admins know what happens if they uninstall. */}
        <div className="retention-note">
          <Icon name="clock" size={15} />
          <span>
            <b>Data retention:</b> if you uninstall HelmDesk, your tickets, agents, and settings are kept for
            <b> 7 days</b> so a reinstall restores everything. After 7 days they’re permanently deleted.
          </span>
        </div>
      </div>
    </>
  );
}
