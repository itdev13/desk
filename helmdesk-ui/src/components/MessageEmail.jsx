import React, { useMemo, useState } from 'react';
import EmailFrame from './EmailFrame.jsx';
import { Avatar, Icon } from './ui.jsx';
import { htmlToText } from '../lib/sanitizeHtml.js';
import { ago } from '../lib/format.js';

/**
 * A single email rendered as a card — ported from PipelinePulse's EmailBody/EmailFull.
 *
 * Collapsed: a header row (sender avatar, name, a one-line preview, time, expand) so the thread stays
 * scannable. Expanded: the From/To address block (when present) + the real email body in a sandboxed
 * EmailFrame, so it keeps its own formatting without leaking styles into the app.
 *
 * `c` is a HelmDesk comment: { body (HTML), authorName, kind, channel, createdAt, emailFrom?, emailTo? }.
 * from/to are optional — HelmDesk doesn't always capture them; the block is omitted when absent.
 */
export default function MessageEmail({ c, onResize }) {
  const [open, setOpen] = useState(false);
  const preview = useMemo(() => htmlToText(c.body || ''), [c.body]);
  const inbound = c.kind === 'customer';
  const name = inbound ? (c.authorName || 'Customer') : (c.authorName || 'Team member');
  const hasAddr = c.emailFrom || c.emailTo;

  return (
    <div className={`email-card ${open ? 'open' : ''}`}>
      {/* Header bar — click anywhere to expand/collapse. */}
      <button type="button" className="email-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Avatar name={name} size={34} />
        <div className="email-card-id">
          <div className="email-card-name">
            {name}
            <span className={`email-dir ${inbound ? 'in' : 'out'}`} title={inbound ? 'Received' : 'Sent'}>
              <Icon name={inbound ? 'arrow-down-left' : 'arrow-up-right'} size={11} />
            </span>
          </div>
          {open
            ? (c.emailTo && <div className="email-card-sub">To: {c.emailTo}</div>)
            : (preview && <div className="email-card-sub">{preview}</div>)}
        </div>
        <span className="email-card-time">{ago(c.createdAt)}</span>
        <span className="email-card-chev"><Icon name={open ? 'chevron-up' : 'chevron'} size={16} /></span>
      </button>

      {open && (
        <div className="email-card-body">
          {hasAddr && (
            <div className="email-addr">
              {c.emailFrom && <div><span className="email-addr-k">From</span><span className="email-addr-v">{c.emailFrom}</span></div>}
              {c.emailTo && <div><span className="email-addr-k">To</span><span className="email-addr-v">{c.emailTo}</span></div>}
            </div>
          )}
          {preview
            ? <EmailFrame html={c.body} onResize={onResize} />
            : <p className="email-nobody">This email has no message text.</p>}
        </div>
      )}
    </div>
  );
}
