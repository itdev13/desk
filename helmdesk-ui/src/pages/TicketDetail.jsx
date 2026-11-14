import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { ago, agoFull, slaDisplay, STATUS_LABEL, PRIORITY_LABEL, labelChannel, labelSource, isCustomProviderChannel, cleanMessageText, ghlContactUrl } from '../lib/format.js';
import { looksLikeHtml } from '../lib/sanitizeHtml.js';
import EmailFrame from '../components/EmailFrame.jsx';
import MessageEmail from '../components/MessageEmail.jsx';
import { Icon, PriorityPill, Avatar, Select } from '../components/ui.jsx';
import { track } from '../lib/analytics.js';

/**
 * The ticket workspace: isolated conversation thread (customer messages, agent replies, internal
 * notes), a composer that toggles between Reply (sent to customer via GHL) and Note (internal),
 * and a side panel to drive status / priority / assignee.
 */
export default function TicketDetail({ id, onBack, user, notify, onChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [mode, setMode] = useState('reply'); // reply | note
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getTicket(id);
      setData(res);
    } catch (err) {
      // Ticket is gone (deleted, or no longer visible) — don't strand the user on a blank detail;
      // fall back to the list. This is what makes a persisted open-ticket safe: if it was deleted
      // while the user was on another tab, returning to Inbox cleanly drops back to the list.
      notify(err.message, true);
      onBack?.();
    } finally {
      setLoading(false);
    }
  }, [id, notify, onBack]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.assignableAgents().then((r) => setAgents(r.agents || [])).catch(() => {}); }, []);
  // If this ticket's channel can't be replied on (Call/portal), force the composer to Note mode.
  useEffect(() => { if (data && data.canReply === false) setMode('note'); }, [data]);
  // Land at the newest message (bottom of the thread), like a normal inbox conversation. Stable so we
  // can also hand it to EmailFrame — those render in an iframe that only reports its real height AFTER
  // load, so an early scroll lands short; each frame calls this again once it has resized.
  //
  // We only auto-scroll during a short settling window after the comment list changes. Email iframes
  // keep firing onResize as they lay out; without the window, a late resize would yank the agent back
  // to the bottom even after they scrolled up to read.
  const autoScrollUntil = useRef(0);
  const scrollToBottom = useCallback(() => {
    if (Date.now() > autoScrollUntil.current) return;
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, []);
  const commentCount = data?.comments?.length || 0;
  useEffect(() => {
    // Open the settling window; iframes re-trigger scrollToBottom via onResize until it closes.
    autoScrollUntil.current = Date.now() + 1200;
    const t = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(t);
  }, [commentCount, scrollToBottom]);

  if (loading) return <div className="empty" style={{ paddingTop: 120 }}><div className="spinner" style={{ margin: '0 auto' }} /></div>;
  if (!data) return null;

  const { ticket, comments, assigneeDeleted, canReply = true } = data;
  const sla = slaDisplay(ticket);
  // The customer's opening message — used to show the full form submission in the Form details card.
  const firstCustomerMessage = (comments.find((c) => c.kind === 'customer')?.body) || '';

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      if (mode === 'reply') {
        await api.reply(id, { body });
        track('reply_sent', { id });
        notify('Reply sent');
      } else {
        await api.note(id, { body });
        track('note_added', { id });
        notify('Note added');
      }
      setBody('');
      await load();
      onChange?.(); // refresh sidebar counts (reply can move new→open)
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSending(false);
    }
  };

  const patch = async (fn, label) => {
    try {
      await fn();
      track('ticket_update', { id, label });
      notify(label);
      await load();
      onChange?.(); // status/priority/assignee change → refresh sidebar counts immediately
    } catch (err) {
      notify(err.message, true);
    }
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
          <div style={{ marginTop: 6 }}>
            {ticket.contactId && ghlContactUrl(ticket.locationId, ticket.contactId) && (
              <a href={ghlContactUrl(ticket.locationId, ticket.contactId)} target="_blank" rel="noopener noreferrer"
                title="Open this contact's profile in a new tab"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 600, color: '#1d4ed8',
                  background: '#eff4ff', border: '1px solid #c7d7fe', borderRadius: 999, padding: '2px 10px', textDecoration: 'none',
                  fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                {ticket.contactName || 'Contact'} · View contact →
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="page">
        <div className="detail">
          {/* Thread + composer */}
          <div>
            <div className="thread">
              {comments.map((c) => {
                const author = c.authorType === 'system'
                  ? (c.authorName || 'Auto-reply')
                  : c.kind === 'customer' ? (c.authorName || 'Customer')
                  : c.kind === 'note' ? `${c.authorName || 'Agent'} · internal note`
                  : (c.authorName || 'Agent');
                // Emails render as an expandable card (sender, preview, From/To, framed body).
                if (c.channel === 'Email' && looksLikeHtml(c.body)) {
                  return <MessageEmail key={c._id} c={c} onResize={scrollToBottom} />;
                }
                return (
                <div key={c._id} className={`msg ${c.kind} ${c.authorType === 'system' ? 'system' : ''}`}>
                  <div className="meta">
                    {author}{' · '}<span title={agoFull(c.createdAt)} style={{ cursor: 'help' }}>{ago(c.createdAt)}</span>
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{cleanMessageText(c.body)}</div>
                </div>
                );
              })}
              {comments.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: 20 }}>No messages yet.</div>}
            </div>

            <div className="composer" style={{ marginTop: 14 }}>
              <div className="composer-tabs">
                <button
                  className={`composer-tab ${mode === 'reply' ? 'active' : ''}`}
                  disabled={!canReply}
                  title={!canReply ? `Can't reply on ${labelChannel(ticket.channel)} — use an internal note` : ''}
                  onClick={() => canReply && setMode('reply')}
                >
                  Reply to customer
                </button>
                <button className={`composer-tab note ${mode === 'note' ? 'active' : ''}`} onClick={() => setMode('note')}>Internal note</button>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={mode === 'reply' ? `Reply to ${ticket.contactName || 'the customer'}…` : 'Add a private note for your team…'}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  {!canReply
                    ? `${labelChannel(ticket.channel)} can't be replied to here — add an internal note, or reply in your CRM.`
                    : mode === 'reply' ? `Sends to the customer via ${labelChannel(ticket.channel)}` : 'Visible to your team only — not sent to the customer'}
                </span>
                <button className="btn btn-accent" disabled={sending || !body.trim()} onClick={send}>
                  <Icon name={mode === 'reply' ? 'send' : 'plus'} size={14} /> {sending ? 'Sending…' : mode === 'reply' ? 'Send reply' : 'Add note'}
                </button>
              </div>
            </div>
            {/* Scroll anchor: on load / after a send we bring this (newest message + composer) into view. */}
            <div ref={threadEndRef} />
          </div>

          {/* Side panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="side-card">
              <h4>Status</h4>
              <Select
                value={ticket.status}
                onChange={(v) => patch(() => api.setStatus(id, v), `Status → ${STATUS_LABEL[v]}`)}
                options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))}
              />
              <div style={{ height: 12 }} />
              <h4>Priority</h4>
              <Select
                value={ticket.priority}
                onChange={(v) => patch(() => api.setPriority(id, v), `Priority → ${PRIORITY_LABEL[v]}`)}
                options={Object.entries(PRIORITY_LABEL).map(([k, v]) => ({ value: k, label: v }))}
              />
              <div style={{ height: 12 }} />
              <h4>Assignee</h4>
              <Select
                value={ticket.assigneeId || ''}
                onChange={(v) => patch(() => api.setAssignee(id, v || null), 'Reassigned')}
                placeholder="Unassigned"
                options={[
                  { value: '', label: 'Unassigned' },
                  // If the current assignee was deleted in the CRM, inject them so the value still shows.
                  ...(assigneeDeleted && ticket.assigneeId && !agents.some((a) => a.ghlUserId === ticket.assigneeId)
                    ? [{ value: ticket.assigneeId, label: `${ticket.assigneeName || 'Deleted user'} (deleted)` }]
                    : []),
                  ...agents.map((a) => ({ value: a.ghlUserId, label: a.email ? `${a.name || "Agent"} (${a.email})` : (a.name || "Agent") }))
                ]}
              />
              {assigneeDeleted && (
                <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--crit-bg)', color: 'var(--crit)', fontSize: 12, lineHeight: 1.4 }}>
                  ⚠️ <strong>{ticket.assigneeName || 'This agent'}</strong> was deleted in your CRM. Please reassign this ticket.
                </div>
              )}
            </div>

            <div className="side-card">
              <h4>SLA</h4>
              <div className="kv"><span className="k">Status</span><span className={`sla ${sla.tone}`}>{sla.text} {sla.sub && `(${sla.sub})`}</span></div>
              <div className="kv"><span className="k">First reply</span><span title={ticket.firstResponseAt ? agoFull(ticket.firstResponseAt) : ''} style={ticket.firstResponseAt ? { cursor: 'help' } : undefined}>{ticket.firstResponseAt ? ago(ticket.firstResponseAt) : '—'}</span></div>
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
              {ticket.contactId && ghlContactUrl(ticket.locationId, ticket.contactId) && (
                <a href={ghlContactUrl(ticket.locationId, ticket.contactId)} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-block', fontSize: 12.5, fontWeight: 600, color: '#1d4ed8', marginBottom: 8, textDecoration: 'none' }}>
                  View contact →
                </a>
              )}
              <div className="kv"><span className="k">{ticket.source === 'portal' ? 'Form' : 'Channel'}</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {ticket.source === 'portal' ? (ticket.formName || 'Support form') : labelChannel(ticket.channel)}
                  {isCustomProviderChannel(ticket.channel) && ticket.conversationProviderId && (
                    <span className="info-dot" title={`Conversation provider id: ${ticket.conversationProviderId}`}>i</span>
                  )}
                </span>
              </div>
              <div className="kv"><span className="k">Source</span><span>{labelSource(ticket.source)}</span></div>
              <div className="kv"><span className="k">Opened</span><span title={agoFull(ticket.createdAt)} style={{ cursor: 'help' }}>{ago(ticket.createdAt)}</span></div>
              <div className="kv"><span className="k">Messages</span><span>{ticket.messageCount}</span></div>
            </div>

            {/* For form submissions, show the FULL submitted record — the content fields (subject,
                message, priority) alongside every custom field — so the whole form is visible in one
                place, not just the custom answers. */}
            {(ticket.source === 'portal' || ticket.customFields?.length > 0) && (
              <div className="side-card">
                <h4>Form details</h4>
                {ticket.source === 'portal' && [
                  ['Subject', ticket.subject],
                  ['Message', cleanMessageText(firstCustomerMessage)],
                  ['Priority', ticket.priority ? PRIORITY_LABEL[ticket.priority] || ticket.priority : '']
                ].filter(([, v]) => v && String(v).trim()).map(([k, v]) => (
                  <div className="kv kv-stack" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                ))}
                {(ticket.customFields || []).map((c, i) => (
                  <div className="kv kv-stack" key={i}><span className="k">{c.label}</span><span className="v">{c.value}</span></div>
                ))}
              </div>
            )}

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

