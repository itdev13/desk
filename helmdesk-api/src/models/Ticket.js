const mongoose = require('mongoose');

/**
 * The core record. A ticket is HelmDesk's own concept — GHL has no notion of it.
 * We store only a *reference* to the GHL contact/conversation (never copy contact PII beyond
 * a cached display name), keeping storage light and data-residency exposure minimal.
 *
 * Multi-tenancy: every query MUST be scoped by locationId. It is first in every compound index.
 */

const STATUSES = ['new', 'open', 'pending', 'on_hold', 'resolved', 'closed'];
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];

const ticketSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    companyId: { type: String, index: true },

    // Human-readable number, e.g. "HD-1042". Unique per workspace.
    number: { type: Number, required: true },
    ref: { type: String, required: true }, // prefixed string form, e.g. "HD-1042"

    subject: { type: String, default: '(no subject)' },
    status: { type: String, enum: STATUSES, default: 'new', index: true },
    priority: { type: String, enum: PRIORITIES, default: 'normal', index: true },

    // GHL linkage — references, not copies.
    contactId: { type: String, index: true },
    conversationId: { type: String, index: true },
    contactName: { type: String, default: null }, // cached for list display only
    contactEmail: { type: String, default: null },
    channel: { type: String, default: null }, // SMS, Email, WhatsApp, FB, IG, Live_Chat, Call, portal

    // How this ticket was born.
    source: { type: String, enum: ['inbound', 'portal', 'manual'], default: 'inbound' },

    assigneeId: { type: String, default: null, index: true }, // GHL userId of the agent
    assigneeName: { type: String, default: null },

    tags: { type: [String], default: [] },

    // ── SLA tracking ──
    slaFirstResponseDueAt: { type: Date, default: null },
    slaResolveDueAt: { type: Date, default: null },
    firstResponseAt: { type: Date, default: null }, // stamped on first outbound agent reply
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    breached: { type: Boolean, default: false, index: true }, // any SLA breached
    slaPaused: { type: Boolean, default: false }, // true while waiting on customer (pending)

    lastCustomerMessageAt: { type: Date, default: null },
    lastAgentMessageAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now, index: true },

    messageCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

// Tenant-first compound indexes for the queue/board/dashboard queries.
ticketSchema.index({ locationId: 1, status: 1, lastActivityAt: -1 });
ticketSchema.index({ locationId: 1, assigneeId: 1, status: 1 });
ticketSchema.index({ locationId: 1, number: 1 }, { unique: true });
// SLA cron query: open tickets with a due date in the past.
ticketSchema.index({ locationId: 1, status: 1, slaFirstResponseDueAt: 1 });

ticketSchema.statics.STATUSES = STATUSES;
ticketSchema.statics.PRIORITIES = PRIORITIES;

// Statuses that count as "open work" (ticket still needs attention).
ticketSchema.statics.OPEN_STATUSES = ['new', 'open', 'pending', 'on_hold'];

module.exports = mongoose.model('Ticket', ticketSchema);
