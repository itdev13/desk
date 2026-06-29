import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import { ago, slaDisplay, STATUS_LABEL, PRIORITY_LABEL } from '../lib/format.js';
import { Icon, PriorityPill, Avatar } from '../components/ui.jsx';

/**
 * The ticket workspace: isolated conversation thread (customer messages, agent replies, internal
 * notes), a composer that toggles between Reply (sent to customer via GHL) and Note (internal),
 * and a side panel to drive status / priority / assignee.
 */
export default function TicketDetail({ id, onBack, user, notify }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [mode, setMode] = useState('reply'); // reply | note
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getTicket(id);
      setData(res);
    } catch (err) {
      notify(err.message, true);
    } finally {
      setLoading(false);
    }
  }, [id, notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.assignableAgents().then((r) => setAgents(r.agents || [])).catch(() => {}); }, []);

  if (loading) return <div className="empty" style={{ paddingTop: 120 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (!data) return null;

  const { ticket, comments, assigneeDeleted } = data;
  const sla = slaDisplay(ticket);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      if (mode === 'reply') {
        await api.reply(id, { body });
        notify('Reply sent');
      } else {
        await api.note(id, { body });
        notify('Note added');
      }
      setBody('');
      await load();
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSending(false);
    }
  };

  const patch = async (fn, label) => {
    try { await fn(); notify(label); await load(); } catch (err) { notify(err.message, true); }
  };

  return (
    <>
      <div className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><Icon name="back" size={14} /> Back</button>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--slate)' }}>{ticket.ref}</span>
            {ticket.subject}
          </h1>
        </div>
      </div>

      <div className="page">
        <div className="detail">
          {/* Thread + composer */}
          <div>
            <div className="thread">
              {comments.map((c) => (
                <div key={c._id} className={`msg ${c.kind}`}>
                  <div className="meta">
                    {c.kind === 'customer' ? (c.authorName || 'Customer') : c.kind === 'note' ? `${c.authorName || 'Agent'} · internal note` : (c.authorName || 'Agent')}
                    {' · '}{ago(c.createdAt)}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                </div>
              ))}
              {comments.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>No messages yet.</div>}
            </div>

            <div className="composer" style={{ marginTop: 14 }}>
              <div className="composer-tabs">
                <button className={`composer-tab ${mode === 'reply' ? 'active' : ''}`} onClick={() => setMode('reply')}>Reply to customer</button>
                <button className={`composer-tab note ${mode === 'note' ? 'active' : ''}`} onClick={() => setMode('note')}>Internal note</button>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={mode === 'reply' ? `Reply to ${ticket.contactName || 'the customer'}…` : 'Add a private note for your team…'}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {mode === 'reply' ? `Sends to the customer via ${labelChannel(ticket.channel)}` : 'Visible to your team only — not sent to the customer'}
                </span>
                <button className="btn btn-accent" disabled={sending || !body.trim()} onClick={send}>
                  <Icon name={mode === 'reply' ? 'send' : 'plus'} size={14} /> {sending ? 'Sending…' : mode === 'reply' ? 'Send reply' : 'Add note'}
                </button>
              </div>
            </div>
          </div>

          {/* Side panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="side-card">
              <h4>Status</h4>
              <select value={ticket.status} onChange={(e) => patch(() => api.setStatus(id, e.target.value), `Status → ${STATUS_LABEL[e.target.value]}`)}>
                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div style={{ height: 12 }} />
              <h4>Priority</h4>
              <select value={ticket.priority} onChange={(e) => patch(() => api.setPriority(id, e.target.value), `Priority → ${PRIORITY_LABEL[e.target.value]}`)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <div style={{ height: 12 }} />
              <h4>Assignee</h4>
              <select value={ticket.assigneeId || ''} onChange={(e) => patch(() => api.setAssignee(id, e.target.value || null), 'Reassigned')}>
                <option value="">Unassigned</option>
                {/* If the current assignee was deleted in the CRM they're not in the assignable list —
                    inject them so the select still shows who it's assigned to. */}
                {assigneeDeleted && ticket.assigneeId && !agents.some((a) => a.ghlUserId === ticket.assigneeId) && (
                  <option value={ticket.assigneeId}>{ticket.assigneeName || 'Deleted user'} (deleted)</option>
                )}
                {agents.map((a) => <option key={a.ghlUserId} value={a.ghlUserId}>{a.name}</option>)}
              </select>
              {assigneeDeleted && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12, lineHeight: 1.4 }}>
                  ⚠️ <strong>{ticket.assigneeName || 'This agent'}</strong> was deleted in your CRM. Please reassign this ticket.
                </div>
              )}
            </div>

            <div className="side-card">
              <h4>SLA</h4>
              <div className="kv"><span className="k">Status</span><span className={`sla ${sla.tone}`}>{sla.text} {sla.sub && `(${sla.sub})`}</span></div>
              <div className="kv"><span className="k">First reply</span><span>{ticket.firstResponseAt ? ago(ticket.firstResponseAt) : '—'}</span></div>
              <div className="kv"><span className="k">Breached</span><span>{ticket.breached ? <span className="pill crit plain">Yes</span> : 'No'}</span></div>
            </div>

            <div className="side-card">
              <h4>Contact</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <Avatar name={ticket.contactName} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ticket.contactName || 'Unknown'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{ticket.contactEmail || ticket.channel}</div>
                </div>
              </div>
              <div className="kv"><span className="k">Channel</span><span>{labelChannel(ticket.channel)}</span></div>
              <div className="kv"><span className="k">Source</span><span style={{ textTransform: 'capitalize' }}>{ticket.source}</span></div>
              <div className="kv"><span className="k">Opened</span><span>{ago(ticket.createdAt)}</span></div>
              <div className="kv"><span className="k">Messages</span><span>{ticket.messageCount}</span></div>
            </div>

            {ticket.status !== 'resolved' && ticket.status !== 'closed' && (
              <button className="btn btn-primary" onClick={() => patch(() => api.setStatus(id, 'resolved'), 'Marked resolved')}>
                <Icon name="check" size={15} /> Mark resolved
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function labelChannel(c) {
  return { Live_Chat: 'Live Chat', WebChat: 'Web Chat', FB: 'Facebook', IG: 'Instagram', GMB: 'Google', portal: 'Portal', SMS: 'SMS', Email: 'Email', WhatsApp: 'WhatsApp', RCS: 'RCS', Custom: 'Custom' }[c] || c || '—';
}
