import React, { useEffect, useState } from 'react';
import { api, portalUrl } from '../lib/api.js';
import { CHANNELS } from '../lib/format.js';
import { Icon, Switch, Select, TagInput } from '../components/ui.jsx';

/** Post-setup configuration. Same fields the wizard collected, plus white-label brand + portal. */
export default function Settings({ onSaved, notify }) {
  const [ws, setWs] = useState(null);
  const [agents, setAgents] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('channels');

  useEffect(() => {
    api.getSettings().then((r) => setWs(r.workspace)).catch((e) => notify(e.message, true));
    api.assignableAgents().then((r) => setAgents(r.agents || [])).catch(() => {});
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
        supportProviderIds: ws.supportProviderIds || [],
        ignoreAutomatedReplies: ws.ignoreAutomatedReplies,
        ignoreShortMessages: ws.ignoreShortMessages,
        skipKeywords: ws.skipKeywords || [],
        createKeywords: ws.createKeywords || [],
        assignmentMode: ws.assignmentMode,
        defaultAssigneeId: ws.defaultAssigneeId,
        slaTargets: ws.slaTargets,
        autoCloseResolvedDays: ws.autoCloseResolvedDays,
        autoReplyEnabled: ws.autoReplyEnabled,
        autoReplyMessage: ws.autoReplyMessage,
        ticketNumberPrefix: ws.ticketNumberPrefix,
        brand: ws.brand,
        portalEnabled: ws.portalEnabled
      });
      setWs(res.workspace);
      onSaved?.(res.workspace);
      notify('Settings saved');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { key: 'channels', label: 'Channels & filters' },
    { key: 'assignment', label: 'Assignment & SLA' },
    { key: 'brand', label: 'Branding & portal' }
  ];

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
      </div>
      <div className="page">
        <div className="filters">
          {tabs.map((t) => <button key={t.key} className={`chip ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>

        {tab === 'channels' && (
          <div className="card">
            <h3>Support channels</h3>
            <p className="muted" style={{ marginBottom: 14 }}>Only messages on these channels become tickets.</p>
            <div className="opt-grid">
              {CHANNELS.map((c) => {
                const on = ws.supportChannels.includes(c.key);
                return (
                  <button key={c.key} className={`opt ${on ? 'on' : ''}`} onClick={() => toggleChannel(c.key)}>
                    <span className="check">{on && <Icon name="check" size={13} />}</span>{c.label}
                  </button>
                );
              })}
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
            {ws.autoReplyEnabled && (
              <div className="field" style={{ marginTop: 14 }}>
                <label>Auto-reply message</label>
                <textarea value={ws.autoReplyMessage} onChange={(e) => set({ autoReplyMessage: e.target.value })} />
              </div>
            )}
          </div>
        )}

        {tab === 'channels' && (
          <ProvidersPanel
            notify={notify}
            selected={ws.supportProviderIds || []}
            onToggle={(id) => set({
              supportProviderIds: (ws.supportProviderIds || []).includes(id)
                ? ws.supportProviderIds.filter((p) => p !== id)
                : [...(ws.supportProviderIds || []), id]
            })}
          />
        )}

        {tab === 'assignment' && (
          <div className="card">
            <h3>Assignment</h3>
            <div className="field" style={{ marginTop: 10 }}>
              <label>Mode</label>
              <Select
                value={ws.assignmentMode}
                onChange={(v) => set({ assignmentMode: v })}
                options={[
                  { value: 'round_robin', label: 'Round-robin across active agents' },
                  { value: 'specific', label: 'Always one agent' },
                  { value: 'unassigned', label: 'Leave unassigned' }
                ]}
              />
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

            <h3 style={{ marginTop: 18 }}>SLA targets (minutes)</h3>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {ws.slaTargets.map((t, i) => (
                <div key={t.priority} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1fr', gap: 10, alignItems: 'center' }}>
                  <span className={`pill ${t.priority}`}>{t.priority}</span>
                  <input type="number" value={t.firstResponseMins} onChange={(e) => { const v = [...ws.slaTargets]; v[i] = { ...t, firstResponseMins: +e.target.value }; set({ slaTargets: v }); }} />
                  <input type="number" value={t.resolveMins} onChange={(e) => { const v = [...ws.slaTargets]; v[i] = { ...t, resolveMins: +e.target.value }; set({ slaTargets: v }); }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 16 }}>
              <div className="field" style={{ margin: 0 }}><label>Auto-close resolved (days)</label><input type="number" value={ws.autoCloseResolvedDays} onChange={(e) => set({ autoCloseResolvedDays: +e.target.value })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Ticket number prefix</label><input type="text" value={ws.ticketNumberPrefix} onChange={(e) => set({ ticketNumberPrefix: e.target.value })} /></div>
            </div>
          </div>
        )}

        {tab === 'brand' && (
          <div className="card">
            <h3>White-label branding</h3>
            <p className="muted" style={{ marginBottom: 14 }}>Make HelmDesk your own when you resell it to clients.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div className="field" style={{ margin: 0 }}><label>Brand name</label><input type="text" value={ws.brand?.name || ''} onChange={(e) => set({ brand: { ...ws.brand, name: e.target.value } })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Primary color</label><input type="text" value={ws.brand?.primaryColor || ''} onChange={(e) => set({ brand: { ...ws.brand, primaryColor: e.target.value } })} placeholder="#E0A24A" /></div>
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
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
          <button className="btn btn-accent" disabled={saving} onClick={save}>
            <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Conversation providers, fetched from GHL at install and stored. Selectable: picking specific
 * providers restricts ticket creation to messages from them (empty = accept all). "Re-sync"
 * re-fetches. Custom providers may not appear (GHL's public API doesn't expose them).
 */
function ProvidersPanel({ notify, selected = [], onToggle }) {
  const [providers, setProviders] = React.useState(null);
  const [syncing, setSyncing] = React.useState(false);

  // Auto-sync when the panel opens — GHL has no provider webhook, so this keeps the list fresh
  // (and detects deletions) whenever an admin views Settings, without per-dashboard-view cost.
  React.useEffect(() => {
    api.syncProviders()
      .then((r) => setProviders(r.providers || []))
      .catch(() => api.providers().then((r) => setProviders(r.providers || [])).catch(() => setProviders([])));
  }, []);

  const resync = async () => {
    setSyncing(true);
    try { const r = await api.syncProviders(); setProviders(r.providers || []); notify(`Synced ${r.count} providers`); }
    catch (err) { notify(err.message, true); }
    finally { setSyncing(false); }
  };

  return (
    <div className="card">
      <div className="section-title" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>Conversation providers</h3>
        <button className="btn btn-ghost btn-sm" disabled={syncing} onClick={resync}>
          <Icon name="users" size={14} /> {syncing ? 'Syncing…' : 'Re-sync'}
        </button>
      </div>
      <p className="muted" style={{ marginBottom: 14 }}>
        Pick specific providers to only accept messages from them — leave all unchecked to accept
        every provider on your channels. Synced from your CRM; custom providers may not appear.
      </p>
      {providers === null ? (
        <div className="muted">Loading…</div>
      ) : providers.length === 0 ? (
        <div className="muted">No providers found yet. Click Re-sync to pull them from your CRM.</div>
      ) : (
        <div className="opt-grid">
          {providers.map((p) => {
            const on = selected.includes(p.providerId);
            return (
              <button
                key={`${p.providerId}-${p.channel}`}
                className={`opt ${on ? 'on' : ''}`}
                style={{ opacity: p.deleted ? 0.6 : 1 }}
                disabled={p.deleted}
                onClick={() => !p.deleted && onToggle?.(p.providerId)}
              >
                <span className="check">{on && <Icon name="check" size={13} />}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                  <span style={{ fontWeight: 600 }}>
                    {p.name || p.providerId}
                    {p.deleted && <span className="pill crit plain" style={{ marginLeft: 6 }}>Deleted</span>}
                  </span>
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--slate)' }}>
                    {p.channel}{p.isDefault && !p.deleted ? ' · default' : ''}{p.deleted ? ' · removed' : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
