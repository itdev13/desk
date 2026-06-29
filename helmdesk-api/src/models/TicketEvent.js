const mongoose = require('mongoose');

/**
 * Append-only audit log for a ticket. Powers "who changed what", reopened-count, and
 * SLA/response-time reporting. Cheap to write now, painful to reconstruct later.
 */
const ticketEventSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },

    type: {
      type: String,
      enum: [
        'created',
        'status_changed',
        'assigned',
        'priority_changed',
        'replied',
        'note_added',
        'customer_replied',
        'sla_breached',
        'reopened',
        'auto_closed',
        'tag_changed'
      ],
      required: true
    },

    actorType: { type: String, enum: ['agent', 'contact', 'system'], default: 'agent' },
    actorId: { type: String, default: null },
    actorName: { type: String, default: null },

    // Free-form context, e.g. { from: 'open', to: 'resolved' }.
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

ticketEventSchema.index({ ticketId: 1, createdAt: 1 });
ticketEventSchema.index({ locationId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model('TicketEvent', ticketEventSchema);
