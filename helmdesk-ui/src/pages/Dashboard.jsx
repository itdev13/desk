import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { fmtMins, STATUS_LABEL, labelChannel } from '../lib/format.js';
import { useAutoRefresh } from '../lib/useAutoRefresh.js';
import { Icon } from '../components/ui.jsx';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

// Per-status colors for the donut + overview bars (semantic, matches the app's status tones).
const STATUS_COLOR = {
  new: '#3b6fb0', open: '#e0a24a', pending: '#d9822b', on_hold: '#7c8aa3',
  resolved: '#2f9e6b', closed: '#5a687f'
};

/**
 * Reporting dashboard — the metrics an agency can show its own clients ("94% in SLA").
 * Everything is computed server-side via aggregation; this just renders.
 */
export default function Dashboard() {
  const [kpis, setKpis] = useState({});
  const [statusCounts, setStatusCounts] = useState({});
  const [byAgent, setByAgent] = useState([]);
  const [byChannel, setByChannel] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [d, t] = await Promise.all([api.dashboard(), api.trend(14)]);
      setKpis(d.kpis || {});
      setStatusCounts(d.statusCounts || {});
      setByAgent(d.byAgent || []);
      setByChannel(d.byChannel || []);
      setTrend(t.trend || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(useCallback(() => load({ silent: true }), [load]));

  if (loading) return (<><div className="topbar"><h1>Dashboard</h1></div><div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div></>);

  const maxAgent = Math.max(1, ...byAgent.map((a) => a.open));
  const maxTrend = Math.max(1, ...trend.flatMap((d) => [d.created, d.resolved]));

  return (
    <>
      <div className="topbar"><h1>Dashboard</h1><span className="sub">Last 30 days</span></div>
      <div className="page">
        <div className="kpis">
          <Kpi n={kpis.open ?? 0} l="Open tickets" icon="inbox" tone="info"
            sub={kpis.unassigned ? `${kpis.unassigned} unassigned` : 'all assigned'} />
          <Kpi n={kpis.overdue ?? 0} l="Overdue" icon="alert" tone={kpis.overdue ? 'alert' : 'good'}
            sub={kpis.overdue ? 'needs attention' : 'none overdue'} subTone={kpis.overdue ? 'alert' : 'good'} />
          <Kpi n={kpis.resolved30d ?? 0} l="Resolved · 30d" icon="check" tone="good"
            sub="last 30 days" />
          <Kpi n={fmtMins(kpis.avgFirstReplyMins)} l="Avg first reply" icon="clock" tone="info"
            sub="time to first response" />
          <Kpi n={kpis.inSlaPct != null ? `${kpis.inSlaPct}%` : '—'} l="In SLA" icon="route"
            tone={kpis.inSlaPct >= 90 ? 'good' : 'alert'}
            sub={kpis.inSlaPct >= 90 ? 'on target' : 'below target'} subTone={kpis.inSlaPct >= 90 ? 'good' : 'alert'} />
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
            {/* Cap the height + scroll so a long roster doesn't stretch the grid row and leave the
                neighbouring chart floating in empty space. */}
            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {byAgent.length === 0 ? <div className="muted">No open tickets.</div> : byAgent.map((a) => (
                <div key={a.agentId || 'none'} className="bar-row">
                  <span className="name">{a.name}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(a.open / maxAgent) * 100}%` }} /></div>
                  <span className="val">{a.open}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="dash-grid">
          {/* Donut: ticket status breakdown */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 14 }}><h2>Ticket status</h2><span className="muted">breakdown</span></div>
            <StatusDonut statusCounts={statusCounts} />
          </div>

          {/* Status overview: each status with a count + mini bar (inspired by the "Board Overview") */}
          <div className="card">
            <div className="section-title" style={{ marginBottom: 14 }}><h2>Status overview</h2></div>
            <StatusOverview statusCounts={statusCounts} />
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginBottom: 14 }}><h2>Tickets by channel</h2></div>
          {byChannel.length === 0 ? <div className="muted">No tickets yet.</div> : (() => {
            const maxCh = Math.max(1, ...byChannel.map((c) => c.count));
            return byChannel.map((c) => (
              <div key={c.channel} className="bar-row">
                <span className="name">{labelChannel(c.channel === 'unknown' ? 'Other' : c.channel)}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${(c.count / maxCh) * 100}%`, background: 'var(--info)' }} /></div>
                <span className="val">{c.count}</span>
              </div>
            ));
          })()}
        </div>
      </div>
    </>
  );
}


// Stat card: icon tile · big number · label · a small context line (inspired by the reference).
function Kpi({ n, l, icon, tone, sub, subTone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-top">
        {icon && <span className={`kpi-ico ${tone || ''}`}><Icon name={icon} size={20} /></span>}
        <div className="kpi-num">
          <div className="n">{n}</div>
          <div className="l">{l}</div>
        </div>
      </div>
      {sub && <div className={`kpi-sub ${subTone || ''}`}>{sub}</div>}
    </div>
  );
}

const STATUS_ORDER = ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'];

// Recharts donut of the status breakdown, with a centered total and a legend.
function StatusDonut({ statusCounts }) {
  const data = STATUS_ORDER
    .map((s) => ({ key: s, name: STATUS_LABEL[s], value: statusCounts[s] || 0, color: STATUS_COLOR[s] }))
    .filter((d) => d.value > 0);
  const total = data.reduce((a, d) => a + d.value, 0);

  if (total === 0) return <div className="muted" style={{ padding: 20, textAlign: 'center' }}>No tickets yet.</div>;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: 180, height: 180, flex: 'none' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius={58} outerRadius={82} paddingAngle={2} stroke="none">
              {data.map((d) => <Cell key={d.key} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--ink)', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 11.5, color: 'var(--slate)', marginTop: 2 }}>total</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d) => (
          <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color, flex: 'none' }} />
            <span style={{ color: 'var(--ink-soft)' }}>{d.name}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--ink)' }}>{d.value}</span>
            <span style={{ fontSize: 11.5, color: 'var(--slate-2)', width: 36, textAlign: 'right' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Each status with its count + a proportional bar — the "Board Overview" idea.
function StatusOverview({ statusCounts }) {
  const rows = STATUS_ORDER.map((s) => ({ key: s, name: STATUS_LABEL[s], value: statusCounts[s] || 0, color: STATUS_COLOR[s] }));
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.map((r) => (
        <div key={r.key}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flex: 'none' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.name}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{r.value}</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--line-soft)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(r.value / max) * 100}%`, background: r.color, borderRadius: 999, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  );
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
