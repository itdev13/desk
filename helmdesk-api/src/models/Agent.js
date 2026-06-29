const mongoose = require('mongoose');

/**
 * A support agent in a workspace, mapped to a GHL user. Drives assignment and @mentions.
 * Synced from GHL's user list; `active` lets an agency exclude users from the round-robin.
 */
const agentSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, index: true },
    ghlUserId: { type: String, required: true, index: true },
    name: { type: String, default: 'Agent' },
    email: { type: String, default: null },
    role: { type: String, enum: ['admin', 'agent'], default: 'agent' },
    active: { type: Boolean, default: true }, // include in round-robin / assignable
    openTicketCount: { type: Number, default: 0 } // denormalized for load display
  },
  { timestamps: true }
);

agentSchema.index({ locationId: 1, ghlUserId: 1 }, { unique: true });

module.exports = mongoose.model('Agent', agentSchema);
