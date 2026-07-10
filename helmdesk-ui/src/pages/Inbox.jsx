import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { ago, slaDisplay, STATUS_LABEL, PRIORITY_LABEL, labelChannel, isCustomProviderChannel } from '../lib/format.js';
import { Icon, PriorityPill, Avatar, Select } from '../components/ui.jsx';
import { useAutoRefresh, useDebounce } from '../lib/useAutoRefresh.js';
import { track } from '../lib/analytics.js';
import { useResizablePanes } from '../lib/useResizable.js';

/**
 * Inbox — a 3-pane ticket workspace (list │ conversation │ details), for working tickets without
 * navigating away. Reuses the same APIs and interaction logic as Queue + TicketDetail; only fields
 * we actually have are shown (priority, assignee, status, tags, channel, SLA, contact).
 *
 * Left: status-tabbed, searchable ticket list. Center: thread + Reply/Note composer.
 * Right: contact card, SLA, and status/priority/assignee controls.
 */

// Status tabs mirror the queue's real statuses. 'all' + open-ish + resolved/closed.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Waiting' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' }
];

export default function Inbox({ user, notify, onChange }) {
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 350);
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({});
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  // Map a status tab → the listTickets `view`/status params we already support.
  const listParams = useCallback(() => {
    const base = { q: debouncedQ || undefined, limit: 50 };
    if (tab === 'all') return { ...base, view: 'all' };
    if (tab === 'open') return { ...base, view: 'open' };
    return { ...base, view: 'all', status: tab }; // pending/resolved/closed filtered by status
  }, [tab, debouncedQ]);

  const loadList = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingList(true);
    try {
      const [list, dash] = await Promise.all([api.listTickets(listParams()), api.dashboard()]);
      const rows = list.tickets || [];
      setTickets(rows);
      // Map raw status counts → our tab keys. 'open' = all open-ish statuses; 'all' = grand total.
      const sc = dash.statusCounts || {};
      const openish = (sc.new || 0) + (sc.open || 0) + (sc.on_hold || 0);
      setCounts({
        all: Object.values(sc).reduce((a, b) => a + b, 0),
        open: openish,
        pending: sc.pending || 0,
        resolved: sc.resolved || 0,
        closed: sc.closed || 0
      });
      // Auto-select the first ticket if none chosen (or the chosen one dropped out of the list).
      setSelectedId((cur) => (cur && rows.some((t) => t._id === cur) ? cur : rows[0]?._id || null));
    } catch (err) {
      if (!silent) notify(err.message, true);
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [listParams, notify]);

  useEffect(() => { loadList(); }, [loadList]);
  useAutoRefresh(useCallback(() => loadList({ silent: true }), [loadList]));

  const onTicketChanged = () => { loadList({ silent: true }); onChange?.(); };

  const { leftW, rightW, leftOpen, rightOpen, startDrag, resetWidths, toggleLeft, toggleRight } = useResizablePanes();

  // Grid columns must match the panes actually rendered — a collapsed pane's <aside> is removed,
  // so we omit its track entirely (otherwise the center would land in a 0px column and shrink).
  const gridCols = [leftOpen ? `${leftW}px` : null, 'minmax(0,1fr)', rightOpen ? `${rightW}px` : null]
    .filter(Boolean).join(' ');

  return (
    <div className="inbox" style={{ gridTemplateColumns: gridCols }}>
      {/* Drag handles on the pane boundaries — drag to resize, double-click to reset. Hidden when
          the adjacent pane is collapsed. */}
      {leftOpen && <div className="inbox-resizer" style={{ left: leftW }} onMouseDown={startDrag('left')}
        onDoubleClick={resetWidths} title="Drag to resize · double-click to reset" />}
      {rightOpen && <div className="inbox-resizer" style={{ right: rightW }} onMouseDown={startDrag('right')}
        onDoubleClick={resetWidths} title="Drag to resize · double-click to reset" />}

      {/* Restore tabs for collapsed panes — circular arrow pointing the way the panel expands. */}
      {!leftOpen && <button className="inbox-toggle-circle restore-left" onClick={toggleLeft} title="Show ticket list"><Icon name="chevron" size={15} /></button>}
      {!rightOpen && <button className="inbox-toggle-circle restore-right" onClick={toggleRight} title="Show details"><Icon name="chevron" size={15} /></button>}

      {/* ── Left: list ── */}
      {leftOpen && (
      <aside className="inbox-list">
        <div className="inbox-list-head">
          <div className="inbox-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`inbox-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
                {counts[t.key] != null && <span className="inbox-tab-n">{counts[t.key]}</span>}
              </button>
            ))}
            <button className="inbox-toggle-circle collapse-left" onClick={toggleLeft} title="Hide ticket list"><Icon name="chevron" size={15} /></button>
          </div>
          <div className="inbox-search">
            <Icon name="search" size={14} />
            <input placeholder="Search subject, contact, #ref…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div className="inbox-rows">
          {loadingList ? (
            <div className="empty"><div className="spinner" style={{ margin: '24px auto' }} /></div>
          ) : tickets.length === 0 ? (
            <div className="inbox-list-empty">
              <span className="dot-pulse" />
              <strong>No tickets in {tab === 'all' ? 'any view' : `“${TABS.find((t) => t.key === tab)?.label}”`}</strong>
              <p>{tab === 'open' ? 'Nothing needs attention right now.' : 'Nothing matches this filter yet.'}</p>
            </div>
          ) : tickets.map((t) => {
            const sla = slaDisplay(t);
            return (
              <button key={t._id} className={`inbox-row ${selectedId === t._id ? 'active' : ''}`} onClick={() => { setSelectedId(t._id); track('ticket_open', { id: t._id, from: 'inbox' }); }}>
                <span className={`stripe ${t.priority}`} />
                <div className="inbox-row-body">
                  <div className="inbox-row-top">
                    <span className="inbox-row-subj">{t.subject}</span>
                    <span className={`inbox-row-sla sla ${sla.tone}`}>{sla.text}</span>
                  </div>
                  <div className="inbox-row-sub">
                    <span className="ref">{t.ref}</span> · {t.contactName || 'Unknown'}
                  </div>
                  <div className="inbox-row-meta">
                    <PriorityPill priority={t.priority} />
                    <span className="inbox-row-ago">{ago(t.lastActivityAt)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      )}

      {/* ── Center + Right: the selected ticket ── */}
      {selectedId
        ? <TicketPanes key={selectedId} id={selectedId} isAdmin={isAdmin} notify={notify} onChanged={onTicketChanged}
            rightOpen={rightOpen} toggleRight={toggleRight} />
        : <InboxEmptyMain hasTickets={tickets.length > 0} loading={loadingList} />}
    </div>
  );
}

/**
 * Center-pane empty state. Context-aware: when there are tickets but none selected → "pick one";
 * when the workspace has no tickets at all → a calmer "you're all set, tickets land here" message.
 */
function InboxEmptyMain({ hasTickets, loading }) {
  if (loading) return <div className="inbox-empty-main" />;
  return (
    <div className="inbox-empty-main">
      <svg className="inbox-empty-art" width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="var(--accent-soft)" />
        <rect x="30" y="44" width="60" height="40" rx="7" fill="#fff" stroke="var(--accent)" strokeWidth="2.5" />
        <path d="M32 50l28 20 28-20" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="90" cy="44" r="11" fill="var(--accent)" />
        <path d="M85.5 44l3 3 6-6.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      {hasTickets ? (
        <>
          <strong>Select a ticket</strong>
          <p>Pick a conversation on the left to read the thread and reply.</p>
        </>
      ) : (
        <>
          <strong>You’re all set</strong>
          <p>No tickets yet. When a customer messages you on a support channel, it appears here automatically — ready to assign and reply.</p>
        </>
      )}
    </div>
  );
}

/** Center thread + composer and the right details pane for one ticket. */
function TicketPanes({ id, isAdmin, notify, onChanged, rightOpen = true, toggleRight }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [mode, setMode] = useState('reply');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try { setData(await api.getTicket(id)); }
    catch (err) { if (!silent) notify(err.message, true); }
    finally { if (!silent) setLoading(false); }
  }, [id, notify]);

  useEffect(() => { load(); setBody(''); setMode('reply'); }, [load]);
  useEffect(() => { if (isAdmin) api.assignableAgents().then((r) => setAgents(r.agents || [])).catch(() => {}); }, [isAdmin]);
  useEffect(() => { if (data && data.canReply === false) setMode('note'); }, [data]);

  if (loading) return <div className="inbox-thread-wrap"><div className="empty"><div className="spinner" style={{ margin: '80px auto' }} /></div></div>;
  if (!data) return null;

  const { ticket, comments, assigneeDeleted, canReply = true } = data;
  const sla = slaDisplay(ticket);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      if (mode === 'reply') { await api.reply(id, { body }); track('reply_sent', { id, from: 'inbox' }); notify('Reply sent'); }
      else { await api.note(id, { body }); track('note_added', { id, from: 'inbox' }); notify('Note added'); }
      setBody('');
      await load({ silent: true });
      onChanged?.();
    } catch (err) { notify(err.message, true); }
    finally { setSending(false); }
  };

  const patch = async (fn, label) => {
    try { await fn(); track('ticket_update', { id, label, from: 'inbox' }); notify(label); await load({ silent: true }); onChanged?.(); }
    catch (err) { notify(err.message, true); }
  };

  return (
    <>
      {/* Center: conversation */}
      <section className="inbox-thread-wrap">
        <header className="inbox-thread-head">
          <div className="inbox-thread-title">
            <span className="ref">{ticket.ref}</span>
            <h2>{ticket.subject}</h2>
          </div>
          <div className="inbox-thread-actions">
            {isAdmin ? (
              <Select
                value={ticket.status}
                onChange={(v) => patch(() => api.setStatus(id, v), `Status → ${STATUS_LABEL[v]}`)}
                options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
              />
            ) : <span className="pill info plain">{STATUS_LABEL[ticket.status]}</span>}
          </div>
        </header>

        <div className="thread inbox-thread">
          {comments.map((c) => {
            const author = c.authorType === 'system' ? (c.authorName || 'Auto-reply')
              : c.kind === 'customer' ? (c.authorName || 'Customer')
              : c.kind === 'note' ? `${c.authorName || 'Agent'} · internal note`
              : (c.authorName || 'Agent');
            return (
              <div key={c._id} className={`msg ${c.kind} ${c.authorType === 'system' ? 'system' : ''}`}>
                <div className="meta">{author} · {ago(c.createdAt)}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              </div>
            );
          })}
          {comments.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>No messages yet.</div>}
        </div>

        <div className="composer inbox-composer">
          <div className="composer-tabs">
            <button className={`composer-tab ${mode === 'reply' ? 'active' : ''}`} disabled={!canReply}
              title={!canReply ? `Can't reply on ${labelChannel(ticket.channel)} — use an internal note` : ''}
              onClick={() => canReply && setMode('reply')}>Reply</button>
            <button className={`composer-tab note ${mode === 'note' ? 'active' : ''}`} onClick={() => setMode('note')}>Internal note</button>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={mode === 'reply' ? `Reply to ${ticket.contactName || 'the customer'}…` : 'Add a private note for your team…'} />
          <div className="inbox-composer-foot">
            <span className="muted" style={{ fontSize: 12 }}>
              {!canReply ? `${labelChannel(ticket.channel)} can't be replied to here — add an internal note.`
                : mode === 'reply' ? `Sends via ${labelChannel(ticket.channel)}` : 'Visible to your team only'}
            </span>
            <button className="btn btn-accent" disabled={sending || !body.trim()} onClick={send}>
              <Icon name={mode === 'reply' ? 'send' : 'plus'} size={14} /> {sending ? 'Sending…' : mode === 'reply' ? 'Send reply' : 'Add note'}
            </button>
          </div>
        </div>
      </section>

      {/* Right: details */}
      {rightOpen && (
      <aside className="inbox-detail">
        <button className="inbox-toggle-circle collapse-right" onClick={toggleRight} title="Hide details"><Icon name="chevron" size={15} /></button>
        <div className="side-card">
          <h4>Contact</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <Avatar name={ticket.contactName} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ticket.contactName || 'Unknown'}</div>
              <div className="muted" style={{ fontSize: 12 }}>{ticket.contactEmail || labelChannel(ticket.channel)}</div>
            </div>
          </div>
          <div className="kv"><span className="k">Channel</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {labelChannel(ticket.channel)}
              {isCustomProviderChannel(ticket.channel) && ticket.conversationProviderId && (
                <span className="info-dot" title={`Conversation provider id: ${ticket.conversationProviderId}`}>i</span>
              )}
            </span>
          </div>
          <div className="kv"><span className="k">Opened</span><span>{ago(ticket.createdAt)}</span></div>
          <div className="kv"><span className="k">Messages</span><span>{ticket.messageCount}</span></div>
        </div>

        <div className="side-card">
          <h4>Details</h4>
          <div className="side-field"><span className="k">Priority</span>
            {isAdmin ? (
              <Select value={ticket.priority}
                onChange={(v) => patch(() => api.setPriority(id, v), `Priority → ${PRIORITY_LABEL[v]}`)}
                options={Object.entries(PRIORITY_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
            ) : <PriorityPill priority={ticket.priority} />}
          </div>
          <div className="side-field"><span className="k">Assignee</span>
            {isAdmin ? (
              <Select value={ticket.assigneeId || ''} placeholder="Unassigned"
                onChange={(v) => patch(() => api.setAssignee(id, v || null), 'Reassigned')}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...(assigneeDeleted && ticket.assigneeId && !agents.some((a) => a.ghlUserId === ticket.assigneeId)
                    ? [{ value: ticket.assigneeId, label: `${ticket.assigneeName || 'Deleted user'} (deleted)` }] : []),
                  ...agents.map((a) => ({ value: a.ghlUserId, label: a.name }))
                ]} />
            ) : <span>{ticket.assigneeName || 'Unassigned'}</span>}
          </div>
          {assigneeDeleted && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12, lineHeight: 1.4 }}>
              ⚠️ <strong>{ticket.assigneeName || 'This agent'}</strong> was deleted in your CRM. Please reassign.
            </div>
          )}
        </div>

        {ticket.customFields?.length > 0 && (
          <div className="side-card">
            <h4>Form details</h4>
            {ticket.customFields.map((c, i) => (
              <div className="kv kv-stack" key={i}><span className="k">{c.label}</span><span className="v">{c.value}</span></div>
            ))}
          </div>
        )}

        <div className="side-card">
          <h4>SLA</h4>
          <div className="kv"><span className="k">Status</span><span className={`sla ${sla.tone}`}>{sla.text}{sla.sub && ` (${sla.sub})`}</span></div>
          <div className="kv"><span className="k">First reply</span><span>{ticket.firstResponseAt ? ago(ticket.firstResponseAt) : '—'}</span></div>
          <div className="kv"><span className="k">Breached</span><span>{ticket.breached ? <span className="pill crit plain">Yes</span> : 'No'}</span></div>
        </div>

        {isAdmin && ticket.status !== 'resolved' && ticket.status !== 'closed' && (
          <button className="btn btn-primary" onClick={() => patch(() => api.setStatus(id, 'resolved'), 'Marked resolved')}>
            <Icon name="check" size={15} /> Mark resolved
          </button>
        )}
      </aside>
      )}
    </>
  );
}
