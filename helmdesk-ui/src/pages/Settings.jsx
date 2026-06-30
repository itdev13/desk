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
        <button className="btn btn-accent" style={{ marginLeft: 'auto' }} disabled={saving} onClick={save}>
          <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save changes'}
        </button>
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
      </div>
    </>
  );
}
