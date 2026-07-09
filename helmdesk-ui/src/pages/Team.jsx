import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Avatar, Switch, Icon } from '../components/ui.jsx';
import { track } from '../lib/analytics.js';

/** Team roster — sync agents from GHL, toggle who's active in the round-robin. */
export default function Team({ notify, onNavPlan }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [seatLimit, setSeatLimit] = useState(null); // null = unknown/unlimited
  const [upgradeUrl, setUpgradeUrl] = useState(''); // GHL upgrade/downgrade deep-link

  const load = () => api.agents().then((r) => setAgents(r.agents || [])).finally(() => setLoading(false));
  useEffect(() => {
    load();
    api.subscription().then((s) => setSeatLimit(s.plan?.seatLimit ?? null)).catch(() => {});
    api.plans().then((r) => setUpgradeUrl(r.upgradeUrl || '')).catch(() => {});
  }, []);

  // Open the GHL upgrade/downgrade page directly; fall back to the in-app Plan page if the URL
  // isn't available yet.
  const goUpgrade = () => {
    if (upgradeUrl) { track('plan_upgrade_click', { from: 'team' }); window.open(upgradeUrl, '_blank', 'noopener'); }
    else onNavPlan?.();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncAgents();
      track('team_sync', { count: r.count, capped: r.diagnostics?.cappedInactive || 0 });
      setAgents(r.agents || []);
      const capped = r.diagnostics?.cappedInactive || 0;
      notify(capped
        ? `Synced ${r.count} agents — ${capped} left inactive (seat limit reached)`
        : `Synced ${r.count} agents`);
    } catch (err) { notify(err.message, true); }
    finally { setSyncing(false); }
  };

  const activeCount = agents.filter((a) => a.active && !a.deleted).length;
  const hasLimit = seatLimit != null && seatLimit < 9999;
  const atOrOver = hasLimit && activeCount >= seatLimit;

  // Display order: assignable (active) first, then excluded, then deleted — each group A→Z by name.
  const rank = (a) => (a.deleted ? 2 : a.active ? 0 : 1);
  const sortedAgents = [...agents].sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''));

  const toggle = async (a, active) => {
    setAgents((list) => list.map((x) => (x.ghlUserId === a.ghlUserId ? { ...x, active } : x)));
    try { await api.updateAgent(a.ghlUserId, { active }); track('agent_toggle', { active }); }
    catch (err) { track('agent_toggle_blocked', { code: err.code }); notify(err.message, true); load(); }
  };

  return (
    <>
      <div className="topbar">
        <h1>Team</h1>
        <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} disabled={syncing} onClick={sync}>
          <Icon name="users" size={15} /> {syncing ? 'Syncing…' : 'Sync team'}
        </button>
      </div>
      <div className="page">
        {hasLimit && (
          <div className={`seat-bar ${atOrOver ? 'is-full' : ''}`}>
            <div className="seat-bar-head">
              <div className="seat-bar-text">
                <b>{activeCount} of {seatLimit}</b> agent seats in use{atOrOver ? ' — limit reached' : ''}.
                {atOrOver && ' Deactivate someone, or move to a bigger plan for more agents.'}
              </div>
              <button type="button" className="link-btn" onClick={goUpgrade}>
                {atOrOver ? 'Upgrade plan →' : 'Need more agents? Switch plan →'}
              </button>
            </div>
            <div className="seat-bar-track"><span style={{ width: `${Math.min(100, (activeCount / seatLimit) * 100)}%` }} /></div>
          </div>
        )}
        {loading ? <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
          <div className="card" style={{ padding: 0 }}>
            {agents.length === 0 ? (
              <div className="empty"><strong>No agents yet</strong><p>Sync your team to start assigning tickets.</p></div>
            ) : sortedAgents.map((a) => (
              <div key={a.ghlUserId} className="toggle-row" style={{ padding: '14px 20px', opacity: a.deleted ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={a.name} />
                  <div>
                    <div className="t-label">
                      {a.name}
                      {a.role === 'admin' && !a.deleted && <span className="pill neutral plain" style={{ marginLeft: 6 }}>Admin</span>}
                      {a.deleted && <span className="pill crit plain" style={{ marginLeft: 6 }}>Deleted in CRM</span>}
                    </div>
                    <div className="t-desc">
                      {a.deleted
                        ? `Removed from your CRM — reassign any of their ${a.openTicketCount || 0} open tickets`
                        : `${a.email || '—'} · ${a.openTicketCount || 0} open`}
                    </div>
                  </div>
                </div>
                {!a.deleted && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="muted" style={{ fontSize: 12 }}>{a.active ? 'Assignable' : 'Excluded'}</span>
                    <Switch checked={a.active} onChange={(v) => toggle(a, v)} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
