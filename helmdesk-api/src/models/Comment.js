const mongoose = require('mongoose');

/**
 * A message or note on a ticket. Three kinds:
 *  - customer  : inbound from the contact (mirrored from GHL)
 *  - reply     : outbound agent reply (sent to the customer via GHL)
 *  - note      : internal-only note (never sent), supports @mentions
 */
const commentSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },

    kind: { type: String, enum: ['customer', 'reply', 'note'], required: true },
    body: { type: String, default: '' },

    // Author. For customer messages this is the contact; for replies/notes it's an agent.
    authorType: { type: String, enum: ['contact', 'agent', 'system'], default: 'agent' },
    authorId: { type: String, default: null }, // GHL userId (agent) or contactId
    authorName: { type: String, default: null },

    channel: { type: String, default: null }, // channel the message went out / came in on
    ghlMessageId: { type: String, default: null }, // link back to the GHL message if applicable
    mentions: { type: [String], default: [] } // GHL userIds @-mentioned in a note
  },
  { timestamps: true }
);

commentSchema.index({ ticketId: 1, createdAt: 1 });

module.exports = mongoose.model('Comment', commentSchema);
