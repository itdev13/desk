import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { fmtMins, STATUS_LABEL } from '../lib/format.js';

/**
 * Reporting dashboard — the metrics an agency can show its own clients ("94% in SLA").
 * Everything is computed server-side via aggregation; this just renders.
 */
export default function Dashboard() {
  const [kpis, setKpis] = useState({});
  const [statusCounts, setStatusCounts] = useState({});
  const [byAgent, setByAgent] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.dashboard(), api.trend(14)])
      .then(([d, t]) => {
        setKpis(d.kpis || {});
        setStatusCounts(d.statusCounts || {});
        setByAgent(d.byAgent || []);
        setTrend(t.trend || []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (<><div className="topbar"><h1>Dashboard</h1></div><div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div></>);

  const maxAgent = Math.max(1, ...byAgent.map((a) => a.open));
  const maxTrend = Math.max(1, ...trend.flatMap((d) => [d.created, d.resolved]));

  return (
    <>
      <div className="topbar"><h1>Dashboard</h1><span className="sub">Last 30 days</span></div>
      <div className="page">
        <div className="kpis">
          <Kpi n={kpis.open ?? 0} l="Open tickets" />
          <Kpi n={kpis.overdue ?? 0} l="Overdue" tone={kpis.overdue ? 'alert' : ''} />
          <Kpi n={kpis.resolved30d ?? 0} l="Resolved · 30d" />
          <Kpi n={fmtMins(kpis.avgFirstReplyMins)} l="Avg first reply" />
          <Kpi n={kpis.inSlaPct != null ? `${kpis.inSlaPct}%` : '—'} l="In SLA" tone={kpis.inSlaPct >= 90 ? 'good' : ''} />
        </div>

        <div className="dash-grid">
          <div className="card">
            <div className="section-title" style={{ marginBottom: 14 }}><h2>Created vs resolved</h2><span className="muted">14 days</span></div>
            <TrendChart trend={trend} max={maxTrend} />
            <div style={{ display: 'flex', gap: 18, marginTop: 12, fontSize: 12.5, color: 'var(--slate)' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--info)', borderRadius: 2, marginRight: 6 }} />Created</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--good)', borderRadius: 2, marginRight: 6 }} />Resolved</span>
            </div>
          </div>

          <div className="card">
            <div className="section-title" style={{ marginBottom: 14 }}><h2>Open by agent</h2></div>
            {byAgent.length === 0 ? <div className="muted">No open tickets.</div> : byAgent.map((a) => (
              <div key={a.agentId || 'none'} className="bar-row">
                <span className="name">{a.name}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(a.open / maxAgent) * 100}%` }} /></div>
                <span className="val">{a.open}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}><h2>Tickets by status</h2></div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'].map((s) => (
              <div key={s} style={{ flex: '1 1 120px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700 }}>{statusCounts[s] || 0}</div>
                <div style={{ fontSize: 12, color: 'var(--slate)' }}>{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ n, l, tone }) {
  return <div className={`kpi ${tone || ''}`}><div className="n">{n}</div><div className="l">{l}</div></div>;
}

function TrendChart({ trend, max }) {
  const W = 100; // percentage-based
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
      {trend.map((d) => (
        <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }} title={`${d.date}: ${d.created} created, ${d.resolved} resolved`}>
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }}>
            <div style={{ flex: 1, height: `${(d.created / max) * 100}%`, background: 'var(--info)', borderRadius: '3px 3px 0 0', minHeight: d.created ? 3 : 0 }} />
            <div style={{ flex: 1, height: `${(d.resolved / max) * 100}%`, background: 'var(--good)', borderRadius: '3px 3px 0 0', minHeight: d.resolved ? 3 : 0 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
