import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Avatar, Switch, Icon } from '../components/ui.jsx';

/** Team roster — sync agents from GHL, toggle who's active in the round-robin. */
export default function Team({ notify }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = () => api.agents().then((r) => setAgents(r.agents || [])).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try { const r = await api.syncAgents(); setAgents(r.agents || []); notify(`Synced ${r.count} agents`); }
    catch (err) { notify(err.message, true); }
    finally { setSyncing(false); }
  };

  const toggle = async (a, active) => {
    setAgents((list) => list.map((x) => (x.ghlUserId === a.ghlUserId ? { ...x, active } : x)));
    try { await api.updateAgent(a.ghlUserId, { active }); } catch (err) { notify(err.message, true); load(); }
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
        {loading ? <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div> : (
          <div className="card" style={{ padding: 0 }}>
            {agents.length === 0 ? (
              <div className="empty"><strong>No agents yet</strong><p>Sync your team to start assigning tickets.</p></div>
            ) : agents.map((a) => (
              <div key={a.ghlUserId} className="toggle-row" style={{ padding: '14px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar name={a.name} />
                  <div>
                    <div className="t-label">{a.name} {a.role === 'admin' && <span className="pill neutral plain" style={{ marginLeft: 6 }}>Admin</span>}</div>
                    <div className="t-desc">{a.email || '—'} · {a.openTicketCount || 0} open</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{a.active ? 'Assignable' : 'Excluded'}</span>
                  <Switch checked={a.active} onChange={(v) => toggle(a, v)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
