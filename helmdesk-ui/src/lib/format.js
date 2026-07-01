// Display helpers shared across screens.

export const PRIORITY_LABEL = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
export const STATUS_LABEL = {
  new: 'New', open: 'Open', pending: 'Pending', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed'
};
// Channel keys are valid values of GHL's message-type enum so a reply can go back on the same channel.
export const CHANNELS = [
  { key: 'Email', label: 'Email' },
  { key: 'SMS', label: 'SMS' },
  { key: 'Live_Chat', label: 'Live Chat' },
  { key: 'WebChat', label: 'Web Chat' },
  { key: 'WhatsApp', label: 'WhatsApp' },
  { key: 'FB', label: 'Facebook' },
  { key: 'IG', label: 'Instagram' },
  { key: 'GMB', label: 'Google' }
];

/** Friendly channel label (shared across Queue, Board, TicketDetail). */
export function labelChannel(c) {
  return {
    SMS: 'SMS', Email: 'Email', WhatsApp: 'WhatsApp', FB: 'Facebook', IG: 'Instagram',
    Live_Chat: 'Live Chat', WebChat: 'Web Chat', GMB: 'Google', Call: 'Call', RCS: 'RCS',
    Custom: 'Custom Provider', CustomSMS: 'Custom Provider SMS', CustomEmail: 'Custom Provider Email',
    portal: 'Portal'
  }[c] || c || '—';
}

/** Is this a custom conversation-provider channel? (Shows the ⓘ provider-id hint.) */
export function isCustomProviderChannel(c) {
  return c === 'Custom' || c === 'CustomSMS' || c === 'CustomEmail';
}

/** A deterministic avatar color from a string. */
const PALETTE = ['#b97e2c', '#3b6fb0', '#2f9e6b', '#5a687f', '#8e5db0', '#c0612f'];
export function avatarColor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

/** Relative "8m ago" style timestamp. */
export function ago(dateish) {
  if (!dateish) return '';
  const d = new Date(dateish);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

/**
 * SLA countdown display from a ticket. Returns { text, sub, tone }.
 * tone: crit (breached/<15m), warn (<2h), good, paused.
 */
export function slaDisplay(ticket) {
  if (ticket.slaPaused || ['resolved', 'closed'].includes(ticket.status)) {
    return { text: ticket.status === 'resolved' ? 'Resolved' : ticket.status === 'closed' ? 'Closed' : 'Paused', sub: ticket.status === 'pending' ? 'waiting on customer' : '', tone: 'paused' };
  }
  // Use first-response target until first reply, then resolve target.
  const due = !ticket.firstResponseAt ? ticket.slaFirstResponseDueAt : ticket.slaResolveDueAt;
  const label = !ticket.firstResponseAt ? 'to first reply' : 'to resolve';
  if (!due) return { text: '—', sub: '', tone: 'good' };
  const mins = Math.round((new Date(due).getTime() - Date.now()) / 60000);
  if (mins < 0) {
    const over = Math.abs(mins);
    return { text: `-${fmtDur(over)}`, sub: 'SLA breach', tone: 'crit' };
  }
  const tone = mins < 15 ? 'crit' : mins < 120 ? 'warn' : 'good';
  return { text: fmtDur(mins), sub: label, tone };
}

/**
 * Human duration in natural units — shows the two most-significant non-zero units, e.g.
 * 45 → "45m", 73 → "1h 13m", 1500 → "1d 1h", 44700 → "1mo 1d", 526000 → "1y".
 * Used for both the SLA countdown and the breach overage.
 */
function fmtDur(mins) {
  if (mins < 1) return '0m';
  const MIN = 1, HOUR = 60, DAY = 60 * 24, MONTH = DAY * 30, YEAR = DAY * 365;
  const units = [
    { v: YEAR, s: 'y' },
    { v: MONTH, s: 'mo' },
    { v: DAY, s: 'd' },
    { v: HOUR, s: 'h' },
    { v: MIN, s: 'm' }
  ];
  const parts = [];
  let rem = mins;
  for (const u of units) {
    if (rem >= u.v) {
      const n = Math.floor(rem / u.v);
      rem -= n * u.v;
      parts.push(`${n}${u.s}`);
      if (parts.length === 2) break;
    } else if (parts.length) {
      break; // stop once we've started, so we show two *consecutive* units (e.g. 1d 1h, not 1d 30m)
    }
  }
  return parts.join(' ') || '0m';
}

export function fmtMins(mins) {
  if (mins == null) return '—';
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}
