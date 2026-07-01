import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { ago, slaDisplay, fmtMins, labelChannel } from '../lib/format.js';
import { Icon, PriorityPill, Avatar } from '../components/ui.jsx';
import NewTicketModal from '../components/NewTicketModal.jsx';
import { useAutoRefresh, useDebounce } from '../lib/useAutoRefresh.js';

const ADMIN_VIEWS = [
  { key: 'mine', label: 'My queue' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'open', label: 'All open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'all', label: 'All' }
];
// Agents only see their own tickets (server-enforced), so the cross-queue views don't apply.
const AGENT_VIEWS = [
  { key: 'open', label: 'Open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'all', label: 'All' }
];

export default function Queue({ onOpen, notify, onChange, user, viewOverride }) {
  const isAdmin = user?.role === 'admin';
  const VIEWS = isAdmin ? ADMIN_VIEWS : AGENT_VIEWS;
  const [view, setView] = useState(viewOverride || 'open');
  // When the nav drives the filter (e.g. clicking the top "Overdue" tab), sync the chip selection.
  useEffect(() => { if (viewOverride) setView(viewOverride); }, [viewOverride]);
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 350); // search fires 350ms after typing stops
  const [tickets, setTickets] = useState([]);
  const [kpis, setKpis] = useState({});
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // silent=true for background polls/focus refreshes: no spinner flicker, no error toast.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [list, dash] = await Promise.all([
        api.listTickets({ view, q: debouncedQ || undefined, limit: 50 }),
        api.dashboard()
      ]);
      setTickets(list.tickets || []);
      setKpis(dash.kpis || {});
    } catch (err) {
      if (!silent) notify(err.message, true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [view, debouncedQ, notify]);

  useEffect(() => { load(); }, [load]);
  // Keep the queue live: poll every 20s + refresh when the tab regains focus.
  useAutoRefresh(useCallback(() => load({ silent: true }), [load]));

  const onCreated = (t) => {
    setShowNew(false);
    notify(`Ticket ${t.ref} created`);
    load();
    onChange?.();
    onOpen(t._id);
  };

  return (
    <>
      <div className="topbar">
        <h1>Queue</h1>
        <div className="search">
          <Icon name="search" size={15} />
          <input
            placeholder="Search subject, contact name, #ref…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="btn btn-accent" onClick={() => setShowNew(true)}><Icon name="plus" size={15} /> New ticket</button>
      </div>

      <div className="page">
        <div className="kpis">
          <Kpi n={kpis.open ?? '—'} l="Open" />
          <Kpi n={kpis.overdue ?? 0} l="Overdue" tone={kpis.overdue ? 'alert' : ''} />
          {isAdmin && <Kpi n={kpis.unassigned ?? 0} l="Unassigned" />}
          <Kpi n={fmtMins(kpis.avgFirstReplyMins)} l="Avg first reply" />
          <Kpi n={kpis.inSlaPct != null ? `${kpis.inSlaPct}%` : '—'} l="In SLA · 30d" tone={kpis.inSlaPct >= 90 ? 'good' : ''} />
        </div>

        <div className="filters">
          {VIEWS.map((v) => (
            <button key={v.key} className={`chip ${view === v.key ? 'active' : ''}`} onClick={() => setView(v.key)}>{v.label}</button>
          ))}
        </div>

        {loading ? (
          <div className="empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : tickets.length === 0 ? (
          <div className="empty">
            <div className="big">🎉</div>
            <strong>Nothing here</strong>
            <p>No tickets match this view. When a customer messages on a support channel, a ticket appears here automatically.</p>
          </div>
        ) : (
          <div className="tlist">
            {tickets.map((t) => <TicketRow key={t._id} t={t} onOpen={onOpen} />)}
          </div>
        )}
      </div>

      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onCreated={onCreated} notify={notify} />}
    </>
  );
}

function Kpi({ n, l, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

function TicketRow({ t, onOpen }) {
  const sla = slaDisplay(t);
  return (
    <button className="trow" onClick={() => onOpen(t._id)}>
      <span className={`stripe ${t.priority}`} />
      <div>
        <div className="id">{t.ref} <PriorityPill priority={t.priority} /></div>
        <div className="subj">{t.subject}</div>
        <div className="sub2">
          {t.contactName || 'Unknown'}{t.channel ? ` · ${labelChannel(t.channel)}` : ''} · {ago(t.lastActivityAt)}
        </div>
      </div>
      <div className="tmeta">
        <div className={`sla ${sla.tone}`}>{sla.text}{sla.sub && <small>{sla.sub}</small>}</div>
        {t.assigneeName ? <Avatar name={t.assigneeName} /> : <div className="avatar" style={{ background: '#cdd5e1', color: '#5a687f' }}>?</div>}
      </div>
      <span className="chev"><Icon name="chevron" size={16} /></span>
    </button>
  );
}

